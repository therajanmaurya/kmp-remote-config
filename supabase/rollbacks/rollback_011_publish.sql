-- Reverses 011_publish.sql.
--
-- Dropping config_version DISCARDS every published snapshot. That is the correct behaviour for
-- a migration rollback — the table is the feature — but it means this file destroys audit
-- history, so take a dump first if the project has been publishing.
DROP TRIGGER   IF EXISTS trg_config_version_immutable ON public.config_version;
DROP FUNCTION  IF EXISTS public.rollback_to(uuid, int);
DROP FUNCTION  IF EXISTS public.publish(uuid);
DROP TABLE     IF EXISTS public.config_version;          -- policies + index go with it
DROP FUNCTION  IF EXISTS public.config_version_immutable();
