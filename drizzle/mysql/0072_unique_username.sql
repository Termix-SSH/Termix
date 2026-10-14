-- Choose an unused prefix from N + 1 disjoint prefixes for N existing users.
WITH ranked AS (
  SELECT id, username,
    ROW_NUMBER() OVER (ORDER BY registered_at, id) AS sequence,
    ROW_NUMBER() OVER (PARTITION BY username ORDER BY registered_at, id) AS occurrence
  FROM users
), candidates AS (
  SELECT 0 AS candidate UNION ALL SELECT sequence FROM ranked
), available AS (
  SELECT MIN(candidate) AS candidate FROM candidates
  WHERE NOT EXISTS (
    SELECT 1 FROM ranked WHERE username LIKE CONCAT(CONCAT('termix-recovered-', candidate, '-'), '%')
  )
)
UPDATE users JOIN ranked ON ranked.id = users.id CROSS JOIN available
SET users.username = CONCAT('termix-recovered-', available.candidate, '-', ranked.sequence)
WHERE ranked.occurrence > 1;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `username` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `idx_users_username` UNIQUE(`username`);
