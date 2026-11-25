-- Choose an unused prefix from N + 1 disjoint prefixes for N existing users.
-- Derived tables, not a CTE: MariaDB before 12 can't put WITH before UPDATE.
UPDATE users
JOIN (
  SELECT id,
    ROW_NUMBER() OVER (ORDER BY registered_at, id) AS sequence,
    ROW_NUMBER() OVER (PARTITION BY username ORDER BY registered_at, id) AS occurrence
  FROM users
) AS ranked ON ranked.id = users.id
CROSS JOIN (
  SELECT MIN(candidates.candidate) AS candidate FROM (
    SELECT 0 AS candidate
    UNION ALL
    SELECT ROW_NUMBER() OVER (ORDER BY registered_at, id) FROM users
  ) AS candidates
  WHERE NOT EXISTS (
    SELECT 1 FROM users AS taken
    WHERE taken.username LIKE CONCAT(CONCAT('termix-recovered-', candidates.candidate, '-'), '%')
  )
) AS available
SET users.username = CONCAT('termix-recovered-', available.candidate, '-', ranked.sequence)
WHERE ranked.occurrence > 1;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `username` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `idx_users_username` UNIQUE(`username`);
