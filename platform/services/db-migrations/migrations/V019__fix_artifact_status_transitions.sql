-- P1-b2b: the immutability trigger blocked approved→active (only retired/superseded were
-- allowed from a locked status). Coverage-rule activation needs approved→active. Fix: keep
-- CONTENT immutability once approved+, but allow the lifecycle status path (draft→in_review→
-- approved→active→retired) — the valid path is enforced app-side by lifecycle.transitionStatus.
CREATE OR REPLACE FUNCTION vkas.enforce_immutability() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('approved','active','retired','superseded') THEN
    IF NEW.content IS DISTINCT FROM OLD.content OR
       NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
       NEW.relations IS DISTINCT FROM OLD.relations THEN
      RAISE EXCEPTION 'Cannot modify content of artifact in status %: canonical_url=%, version=%',
        OLD.status, OLD.canonical_url, OLD.version;
    END IF;
    -- status-path restriction removed: approved→active (and other valid transitions) now permitted
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
