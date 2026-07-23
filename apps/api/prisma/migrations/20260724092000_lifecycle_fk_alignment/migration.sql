-- Every other foreign key in this schema is `ON DELETE CASCADE ON UPDATE CASCADE`
-- (Prisma's default for a required relation). The two lifecycle tables were
-- written by hand and omitted the update clause, which is a difference with no
-- reason behind it — and one `prisma migrate diff` reports forever, training
-- people to skip the drift check.
ALTER TABLE password_reset_tokens
  DROP CONSTRAINT password_reset_tokens_account_id_fkey,
  ADD  CONSTRAINT password_reset_tokens_account_id_fkey
       FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE invitations
  DROP CONSTRAINT invitations_license_id_fkey,
  ADD  CONSTRAINT invitations_license_id_fkey
       FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE invitations
  DROP CONSTRAINT invitations_invited_by_id_fkey,
  ADD  CONSTRAINT invitations_invited_by_id_fkey
       FOREIGN KEY (invited_by_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE;
