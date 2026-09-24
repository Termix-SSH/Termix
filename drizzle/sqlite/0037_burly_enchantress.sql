-- session_shares, session_share_participants, collab_rooms and
-- collab_room_members moved to the session-sharing plugin, whose first
-- migration renames them. Dropping them here would lose every share and
-- room, so this only stops drizzle tracking them. SELECT 1 because MySQL
-- rejects an empty query.
SELECT 1;