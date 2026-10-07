-- Console server routes write officer signatures *as the officer*: they SET ROLE authenticated and
-- set request.jwt.claims to the verified officer JWT, so the RLS policy (is_officer) still decides.
-- INHERIT FALSE: console_svc gains nothing from this grant unless it explicitly SETs ROLE.
grant authenticated to console_svc with inherit false, set true;
