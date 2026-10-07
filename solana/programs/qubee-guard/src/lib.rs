//! QUBEE Solana Guard: a Token-2022 transfer hook that enforces QUBEE threat state.
//! Every transfer of a protected mint (qUSD-S) reads that mint's Guard PDA. NORMAL allows the transfer;
//! CONTAINED makes it fail on-chain. The threat decision is made elsewhere (QUBEE on Ethereum, Chainlink CRE);
//! the hook only enforces it and never calls out.
use {
    anchor_lang::prelude::*,
    anchor_spl::{
        token_2022::{
            spl_token_2022::{
                extension::{transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions},
                state::Account as Token2022Account,
            },
            ID as TOKEN_2022_PROGRAM_ID,
        },
        token_interface::{Mint, TokenAccount},
    },
    spl_discriminator::SplDiscriminate,
    spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList},
    spl_transfer_hook_interface::{
        error::TransferHookError,
        instruction::{ExecuteInstruction, InitializeExtraAccountMetaListInstruction},
    },
};

declare_id!("11111111111111111111111111111111");

pub const NORMAL: u8 = 0;
pub const CONTAINED: u8 = 1;
/// QUBEE classifications: 0 BEHAVIOR, 1 LINKED, 2 CONFIRMED. Only CONFIRMED may contain.
pub const CONFIRMED: u8 = 2;

#[program]
pub mod qubee_guard {
    use super::*;

    /// One Guard per protected mint. Only the mint authority may create it, so nobody can squat another org's guard.
    pub fn initialize_guard(ctx: Context<InitializeGuard>, org_id: u32) -> Result<()> {
        only_mint_authority(&ctx.accounts.mint, &ctx.accounts.authority)?;
        let g = &mut ctx.accounts.guard;
        g.version = 1;
        g.org_id = org_id;
        g.mode = NORMAL;
        g.authority = ctx.accounts.authority.key();
        g.mint = ctx.accounts.mint.key();
        g.updated_slot = Clock::get()?.slot;
        g.bump = ctx.bumps.guard;
        Ok(())
    }

    /// Tells Token-2022 which extra account every transfer needs: the Guard PDA, seeds ["guard", mint].
    #[instruction(discriminator = InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn initialize_extra_account_meta_list(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
        only_mint_authority(&ctx.accounts.mint, &ctx.accounts.authority)?;
        let metas = [ExtraAccountMeta::new_with_seeds(
            &[Seed::Literal { bytes: b"guard".to_vec() }, Seed::AccountKey { index: 1 }],
            false,
            false,
        )?];
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut ctx.accounts.extra_metas_account.try_borrow_mut_data()?, &metas)?;
        Ok(())
    }

    /// Contain: only the guard's authority, only for a CONFIRMED threat, never with evidence older than what is
    /// stored. Re-applying the same threat leaves the same state.
    pub fn set_guard_contained(
        ctx: Context<SetGuard>,
        classification: u8,
        threat_case_hash: [u8; 32],
        source_chain: u64,
        source_evidence_hash: [u8; 32],
        issued_at: i64,
    ) -> Result<()> {
        require!(classification == CONFIRMED, GuardError::NotConfirmed);
        let g = &mut ctx.accounts.guard;
        require!(issued_at >= g.issued_at, GuardError::StaleReport);
        g.mode = CONTAINED;
        g.threat_case_hash = threat_case_hash;
        g.source_chain = source_chain;
        g.source_evidence_hash = source_evidence_hash;
        g.issued_at = issued_at;
        g.updated_slot = Clock::get()?.slot;
        Ok(())
    }

    /// Demo reset only; same authority check as containment.
    pub fn set_guard_normal(ctx: Context<SetGuard>) -> Result<()> {
        let g = &mut ctx.accounts.guard;
        g.mode = NORMAL;
        g.updated_slot = Clock::get()?.slot;
        Ok(())
    }

    /// Token-2022 calls this on every transfer of the mint.
    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn execute(ctx: Context<Execute>, _amount: u64) -> Result<()> {
        check_transferring(&ctx.accounts.source_account.to_account_info().try_borrow_data()?)?;
        require!(ctx.accounts.guard.mode != CONTAINED, GuardError::GuardContained);
        Ok(())
    }
}

fn only_mint_authority(mint: &InterfaceAccount<Mint>, signer: &Signer) -> Result<()> {
    require!(mint.mint_authority.ok_or(GuardError::NotMintAuthority)? == signer.key(), GuardError::NotMintAuthority);
    Ok(())
}

/// The hook must only run inside a real Token-2022 transfer, not be called directly.
fn check_transferring(account_data: &[u8]) -> Result<()> {
    let account = StateWithExtensions::<Token2022Account>::unpack(account_data)?;
    if bool::from(account.get_extension::<TransferHookAccount>()?.transferring) {
        Ok(())
    } else {
        Err(Into::<ProgramError>::into(TransferHookError::ProgramCalledOutsideOfTransfer).into())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Guard {
    pub version: u8,
    pub org_id: u32,
    pub mode: u8,
    pub threat_case_hash: [u8; 32],
    /// EVM chain id the evidence came from (e.g. 11155111 Ethereum Sepolia).
    pub source_chain: u64,
    pub source_evidence_hash: [u8; 32],
    pub issued_at: i64,
    pub updated_slot: u64,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeGuard<'info> {
    #[account(init, payer = authority, space = 8 + Guard::INIT_SPACE, seeds = [b"guard", mint.key().as_ref()], bump)]
    pub guard: Account<'info, Guard>,
    #[account(mint::token_program = TOKEN_2022_PROGRAM_ID)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    /// CHECK: TLV buffer created and written here
    #[account(init, payer = authority, space = ExtraAccountMetaList::size_of(1).unwrap(), seeds = [b"extra-account-metas", mint.key().as_ref()], bump)]
    pub extra_metas_account: UncheckedAccount<'info>,
    #[account(mint::token_program = TOKEN_2022_PROGRAM_ID)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetGuard<'info> {
    #[account(mut, has_one = authority, seeds = [b"guard", guard.mint.as_ref()], bump = guard.bump)]
    pub guard: Account<'info, Guard>,
    pub authority: Signer<'info>,
}

/// Account order is fixed by the transfer hook interface: source, mint, destination, owner, extra metas, extras.
#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(token::mint = mint, token::token_program = TOKEN_2022_PROGRAM_ID)]
    pub source_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mint::token_program = TOKEN_2022_PROGRAM_ID)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(token::mint = mint, token::token_program = TOKEN_2022_PROGRAM_ID)]
    pub destination_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: source owner or delegate; Token-2022 has already checked it
    pub owner: UncheckedAccount<'info>,
    /// CHECK: the list Token-2022 resolved the extra accounts from
    #[account(seeds = [b"extra-account-metas", mint.key().as_ref()], bump)]
    pub extra_metas_account: UncheckedAccount<'info>,
    /// Checked by seeds and owner, so a fake NORMAL guard cannot be passed in.
    #[account(seeds = [b"guard", mint.key().as_ref()], bump = guard.bump)]
    pub guard: Account<'info, Guard>,
}

#[error_code]
pub enum GuardError {
    #[msg("QUBEE Guard is CONTAINED: transfer rejected")]
    GuardContained,
    #[msg("Only a CONFIRMED threat can contain")]
    NotConfirmed,
    #[msg("Older evidence cannot override newer guard state")]
    StaleReport,
    #[msg("Signer is not the mint authority")]
    NotMintAuthority,
}
