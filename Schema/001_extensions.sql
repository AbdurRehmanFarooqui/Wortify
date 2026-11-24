-- Run BEFORE the generated table migration (tables use citext and trigram indexes).
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email / handle / code
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fuzzy product search
