-- Choose an unused prefix from N + 1 disjoint prefixes for N existing users.
WITH ranked AS MATERIALIZED (
  SELECT id, username,
    ROW_NUMBER() OVER (ORDER BY registered_at, id) AS sequence,
    ROW_NUMBER() OVER (PARTITION BY username ORDER BY registered_at, id) AS occurrence
  FROM users
), candidates AS (
  SELECT 0 AS candidate UNION ALL SELECT sequence FROM ranked
), available AS (
  SELECT MIN(candidate) AS candidate FROM candidates
  WHERE NOT EXISTS (
    SELECT 1 FROM ranked WHERE username LIKE 'termix-recovered-' || candidate || '-' || '%'
  )
)
UPDATE users SET username = 'termix-recovered-' || (SELECT candidate FROM available) || '-' || ranked.sequence
FROM ranked WHERE ranked.id = users.id AND ranked.occurrence > 1;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET DATA TYPE varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_username" ON "users" USING btree ("username");
