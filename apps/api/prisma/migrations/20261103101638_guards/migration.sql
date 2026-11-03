-- Immutable audit tables and a balanced, append-only ledger, enforced by the database itself.
CREATE OR REPLACE FUNCTION agrimate_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_event_immutable BEFORE UPDATE OR DELETE ON "OrderEvent" FOR EACH ROW EXECUTE FUNCTION agrimate_block_mutation();
CREATE TRIGGER journal_immutable BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION agrimate_block_mutation();
CREATE TRIGGER posting_immutable BEFORE UPDATE OR DELETE ON "LedgerPosting" FOR EACH ROW EXECUTE FUNCTION agrimate_block_mutation();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION agrimate_block_mutation();

-- Checked at COMMIT, so a journal's postings can be inserted one at a time inside a transaction.
CREATE OR REPLACE FUNCTION agrimate_check_journal_balanced() RETURNS trigger AS $$
DECLARE total NUMERIC;
BEGIN
  SELECT COALESCE(SUM("amountPaise"), 0) INTO total FROM "LedgerPosting" WHERE "journalId" = NEW."journalId";
  IF total <> 0 THEN
    RAISE EXCEPTION 'Journal % is unbalanced by % paise', NEW."journalId", total USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER posting_balanced AFTER INSERT ON "LedgerPosting"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agrimate_check_journal_balanced();

ALTER TABLE "Tranche" ADD CONSTRAINT tranche_amounts_non_negative CHECK ("expectedPaise" >= 0 AND "receivedPaise" >= 0);
ALTER TABLE "Payout" ADD CONSTRAINT payout_non_negative CHECK ("amountPaise" >= 0);
