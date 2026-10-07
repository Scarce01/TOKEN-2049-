//! Qu3ee Solana Guard (hackathon work, TOKEN2049 2026-10-07).
//!
//! A Token-2022 transfer hook. Every transfer of a protected mint (the demo asset is qUSD-S) calls `execute`,
//! which reads the mint's Guard PDA: NORMAL lets the transfer through, CONTAINED fails it on chain.
//!
//! The decision is made elsewhere: the Chainlink DON confirms a decoy touch on the EVM side (Trap workflow) and
//! the Guard's authority carries that confirmed threat here with its source evidence. The hook itself makes no
//! external calls and runs no tracing; it only enforces the state.
//!
//! Rules (mirroring the EVM side, CLAUDE.md):
//! - only the Guard's authority changes its state (rule 3)
//! - containment is idempotent: the same case twice leaves the same state (rule 4)
//! - evidence older than what the Guard already holds is refused, so a stale report cannot reopen a mint
//! - a Guard belongs to one org and one mint: org A's containment never touches org B's asset
use {
    anchor_lang::prelude::*,
    anchor_spl::{
        token_2022::{
            spl_token_2022::{
                extension::{
                    transfer_hook::{TransferHook, TransferHookAccount},
                    BaseStateWithExtensions, StateWithExtensions,
                },
                state::{Account as Token2022Account, Mint as Token2022Mint},
            },
            ID as TOKEN_2022_PROGRAM_ID,
        },
        token_interface::{Mint, TokenAccount},
    },
    spl_discriminator::SplDiscriminate,
    spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList},
    spl_transfer_hook_interface::{
        error::TransferHookError,
        instruction::{ExecuteInstruction, TransferHookInstruction},
    },
};

declare_id!("HaJ4J8KhE5FGfBFpgrwkqXk6yXfdjNYJpLjJ71KGrEXz");

pub const GUARD_SEED: &[u8] = b"guard";
pub const EXTRA_METAS_SEED: &[u8] = b"extra-account-metas";
pub const GUARD_VERSION: u8 = 1;

pub const MODE_NORMAL: u8 = 0;
pub const MODE_CONTAINED: u8 = 1;

#[program]
pub mod qu3ee_guard {
    use super::*;

    /// One Guard per protected mint. The mint authority signs, so nobody else can claim a mint's Guard first,
    /// and the mint must already name this program as its transfer hook.
    pub fn initialize_guard(ctx: Context<InitializeGuard>, org_id: [u8; 32], authority: Pubkey) -> Result<()> {
        let mint = &ctx.accounts.mint;
        require!(
            mint.mint_authority == Some(ctx.accounts.mint_authority.key()).into(),
            GuardError::NotMintAuthority
        );
        {
            let info = mint.to_account_info();
            let data = info.try_borrow_data()?;
            let state = StateWithExtensions::<Token2022Mint>::unpack(&data)?;
            let hook = state.get_extension::<TransferHook>().map_err(|_| error!(GuardError::MintHookMismatch))?;
            let program: Option<Pubkey> = hook.program_id.into();
            require!(program == Some(crate::ID), GuardError::MintHookMismatch);
        }
        let g = &mut ctx.accounts.guard;
        g.version = GUARD_VERSION;
        g.org_id = org_id;
        g.mint = mint.key();
        g.mode = MODE_NORMAL;
        g.threat_case_hash = [0; 32];
        g.source_chain = 0;
        g.source_evidence_hash = [0; 32];
        g.source_seq = 0;
        g.updated_slot = Clock::get()?.slot;
        g.authority = authority;
        g.bump = ctx.bumps.guard;
        emit!(GuardInitialized { org_id, mint: g.mint, authority });
        Ok(())
    }

    /// The accounts Token-2022 must pass to `execute`: only this mint's Guard PDA. Fixed here, not taken from
    /// the caller, so a client cannot point the hook at a different Guard.
    pub fn initialize_extra_account_meta_list(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
        require!(
            ctx.accounts.mint.mint_authority == Some(ctx.accounts.mint_authority.key()).into(),
            GuardError::NotMintAuthority
        );
        let metas = extra_metas()?;
        let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
        Ok(())
    }

    /// A confirmed Qu3ee threat reached Solana: freeze this org's protected asset.
    pub fn set_guard_contained(ctx: Context<SetGuard>, report: ThreatReport) -> Result<()> {
        let g = &mut ctx.accounts.guard;
        require!(report.source_seq >= g.source_seq, GuardError::StaleReport);
        if g.mode == MODE_CONTAINED && g.threat_case_hash == report.threat_case_hash {
            return Ok(()); // same case again: state stays as it is
        }
        g.mode = MODE_CONTAINED;
        g.threat_case_hash = report.threat_case_hash;
        g.source_chain = report.source_chain;
        g.source_evidence_hash = report.source_evidence_hash;
        g.source_seq = report.source_seq;
        g.updated_slot = Clock::get()?.slot;
        emit!(GuardContained {
            org_id: g.org_id,
            mint: g.mint,
            threat_case_hash: report.threat_case_hash,
            source_chain: report.source_chain,
            source_evidence_hash: report.source_evidence_hash,
            source_seq: report.source_seq,
        });
        Ok(())
    }

    /// Demo reset only. Needs the authority and evidence at least as new as what the Guard holds.
    pub fn set_guard_normal(ctx: Context<SetGuard>, source_seq: u64) -> Result<()> {
        let g = &mut ctx.accounts.guard;
        require!(source_seq >= g.source_seq, GuardError::StaleReport);
        g.mode = MODE_NORMAL;
        g.source_seq = source_seq;
        g.updated_slot = Clock::get()?.slot;
        emit!(GuardNormal { org_id: g.org_id, mint: g.mint, source_seq });
        Ok(())
    }

    /// Called by Token-2022 on every transfer of the protected mint.
    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        // only inside a real Token-2022 transfer
        check_is_transferring(&ctx.accounts.source_account.to_account_info().try_borrow_data()?)?;
        check_is_transferring(&ctx.accounts.destination_account.to_account_info().try_borrow_data()?)?;
        // the extra accounts are exactly the ones the meta list names
        let data = ctx.accounts.extra_account_meta_list.try_borrow_data()?;
        ExtraAccountMetaList::check_account_infos::<ExecuteInstruction>(
            &ctx.accounts.to_account_infos(),
            &TransferHookInstruction::Execute { amount }.pack(),
            ctx.program_id,
            &data,
        )?;
        require!(ctx.accounts.guard.mode == MODE_NORMAL, GuardError::Contained);
        Ok(())
    }
}

fn extra_metas() -> Result<Vec<ExtraAccountMeta>> {
    // Execute accounts: 0 source, 1 mint, 2 destination, 3 owner, 4 meta list, then extras.
    Ok(vec![ExtraAccountMeta::new_with_seeds(
        &[Seed::Literal { bytes: GUARD_SEED.to_vec() }, Seed::AccountKey { index: 1 }],
        false,
        false,
    )?])
}

fn check_is_transferring(account_data: &[u8]) -> Result<()> {
    let account = StateWithExtensions::<Token2022Account>::unpack(account_data)?;
    let ext = account.get_extension::<TransferHookAccount>()?;
    if bool::from(ext.transferring) {
        Ok(())
    } else {
        Err(Into::<ProgramError>::into(TransferHookError::ProgramCalledOutsideOfTransfer))?
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ThreatReport {
    /// Qu3ee case id (keccak of the Trap case on the EVM side)
    pub threat_case_hash: [u8; 32],
    /// EVM chain id of the evidence, e.g. 84532 Base Sepolia
    pub source_chain: u64,
    /// the EVM transaction that carried the DON report
    pub source_evidence_hash: [u8; 32],
    /// ordering of evidence: the EVM block number of that report
    pub source_seq: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Guard {
    pub version: u8,
    pub org_id: [u8; 32],
    pub mint: Pubkey,
    pub mode: u8,
    pub threat_case_hash: [u8; 32],
    pub source_chain: u64,
    pub source_evidence_hash: [u8; 32],
    pub source_seq: u64,
    pub updated_slot: u64,
    pub authority: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeGuard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint_authority: Signer<'info>,
    #[account(mint::token_program = TOKEN_2022_PROGRAM_ID)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = payer, space = 8 + Guard::INIT_SPACE, seeds = [GUARD_SEED, mint.key().as_ref()], bump)]
    pub guard: Account<'info, Guard>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint_authority: Signer<'info>,
    #[account(mint::token_program = TOKEN_2022_PROGRAM_ID)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: TLV buffer, written by ExtraAccountMetaList::init
    #[account(init, payer = payer, space = ExtraAccountMetaList::size_of(1).unwrap(),
        seeds = [EXTRA_METAS_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetGuard<'info> {
    #[account(address = guard.authority @ GuardError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [GUARD_SEED, guard.mint.as_ref()], bump = guard.bump)]
    pub guard: Account<'info, Guard>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(token::mint = mint, token::token_program = TOKEN_2022_PROGRAM_ID)]
    pub source_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mint::token_program = TOKEN_2022_PROGRAM_ID)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(token::mint = mint, token::token_program = TOKEN_2022_PROGRAM_ID)]
    pub destination_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: source owner or delegate; Token-2022 already checked the signature
    pub owner: UncheckedAccount<'info>,
    /// CHECK: TLV buffer of this mint's extra accounts
    #[account(seeds = [EXTRA_METAS_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(seeds = [GUARD_SEED, mint.key().as_ref()], bump = guard.bump)]
    pub guard: Account<'info, Guard>,
}

#[event]
pub struct GuardInitialized {
    pub org_id: [u8; 32],
    pub mint: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct GuardContained {
    pub org_id: [u8; 32],
    pub mint: Pubkey,
    pub threat_case_hash: [u8; 32],
    pub source_chain: u64,
    pub source_evidence_hash: [u8; 32],
    pub source_seq: u64,
}

#[event]
pub struct GuardNormal {
    pub org_id: [u8; 32],
    pub mint: Pubkey,
    pub source_seq: u64,
}

#[error_code]
pub enum GuardError {
    #[msg("Qu3ee guard is CONTAINED: transfer rejected")]
    Contained,
    #[msg("signer is not the guard authority")]
    Unauthorized,
    #[msg("evidence is older than the guard's current state")]
    StaleReport,
    #[msg("signer is not the mint authority")]
    NotMintAuthority,
    #[msg("mint does not use this program as its transfer hook")]
    MintHookMismatch,
}
