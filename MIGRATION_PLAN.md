# Migration Plan: Per-User Buckets

## Overview

Transition from shared global buckets to per-user buckets (habits). Each user can have up to 5 custom habits.

## Current State

- `buckets` table: Global, shared by all users (3 buckets)
- `entries` table: Already user-scoped, but `bucket_id` references global buckets
- Bucket management: Admin-only in settings

## Target State

- Each user has their own buckets (max 5)
- New users get 3 default buckets copied to their account
- Users can add/edit/delete their own buckets in Settings
- Admin retains only "Danger Zone" controls
- Existing entries preserved and linked to user's own buckets

---

## Implementation Checklist

### Phase 1: Database Schema Migration

- [x] 1.1 Add `user_id` column to `buckets` table (nullable initially)
- [x] 1.2 Create migration logic in `ensureSchema()`:
  - For each user, copy global buckets with their user_id
  - Update entries to point to user's own bucket (by matching bucket name)
  - Delete global buckets (user_id = NULL)
- [x] 1.3 Update unique constraint from `(name)` to `(user_id, name)`
- [x] 1.4 Update `seedBuckets()` to no longer auto-create global buckets
- [x] 1.5 Create function to copy default buckets for new users on signup

### Phase 2: API Changes

- [x] 2.1 `GET /api/buckets`: Return only current user's buckets
- [x] 2.2 `POST /api/buckets`: Create for current user, enforce 5-bucket limit
- [x] 2.3 `PUT /api/buckets`: Only allow editing user's own buckets
- [x] 2.4 `DELETE /api/buckets`: Only allow deleting user's own buckets
- [x] 2.5 `POST /api/checkins`: Validate bucket belongs to current user
- [x] 2.6 `GET /api/checkins`: Include bucket info per user for friend display

### Phase 3: Frontend Changes

- [x] 3.1 Move bucket management to Settings (available to all users)
- [x] 3.2 Remove admin-only bucket controls
- [x] 3.3 Update "Manage Habits" UI with add/edit/delete (max 5 limit)
- [x] 3.4 Update friend progress display to show X/(their total)
- [x] 3.5 Update heatmap tooltips to show friend's bucket names (not yours)
- [x] 3.6 Update streak/stats calculations for variable bucket counts

### Phase 4: Testing & Cleanup

- [x] 4.1 TypeScript build passes
- [x] 4.2 Unit tests pass
- [x] 4.3 Code review complete
- [ ] 4.4 Manual testing with running server (requires `vercel dev`)

---

## Database Schema Changes

### Before

```sql
CREATE TABLE buckets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Unique index on (name)
```

### After

```sql
CREATE TABLE buckets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Unique index on (user_id, name)
```

---

## Migration SQL Logic

```sql
-- Step 1: Add nullable user_id column
ALTER TABLE buckets ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Step 2: For each user, create copies of global buckets
INSERT INTO buckets (user_id, name, sort_order)
SELECT u.id, b.name, b.sort_order
FROM users u
CROSS JOIN buckets b
WHERE b.user_id IS NULL;

-- Step 3: Update entries to point to user's own bucket
UPDATE entries e
SET bucket_id = (
  SELECT ub.id FROM buckets ub
  WHERE ub.user_id = e.user_id
    AND ub.name = (SELECT ob.name FROM buckets ob WHERE ob.id = e.bucket_id)
)
WHERE EXISTS (
  SELECT 1 FROM buckets ub
  WHERE ub.user_id = e.user_id
    AND ub.name = (SELECT ob.name FROM buckets ob WHERE ob.id = e.bucket_id)
);

-- Step 4: Delete global buckets
DELETE FROM buckets WHERE user_id IS NULL;

-- Step 5: Make user_id NOT NULL
ALTER TABLE buckets ALTER COLUMN user_id SET NOT NULL;

-- Step 6: Drop old unique index, create new one
DROP INDEX IF EXISTS buckets_name_unique;
CREATE UNIQUE INDEX buckets_user_name_unique ON buckets(user_id, name);
```

---

## Default Buckets (for new users)

```javascript
const DEFAULT_BUCKETS = [
  { name: '10 min calisthenics', sortOrder: 1 },
  { name: '25 min cardio', sortOrder: 2 },
  { name: 'Stretching / mobility', sortOrder: 3 },
]
```

---

## API Behavior Changes

### GET /api/buckets
- Before: Returns all global buckets
- After: Returns only `WHERE user_id = currentUser.id`

### POST /api/buckets
- Before: Creates global bucket (admin only implied)
- After: Creates bucket for current user, rejects if count >= 5

### PUT /api/buckets
- Before: Updates any bucket by id
- After: Updates only if `bucket.user_id = currentUser.id`

### DELETE /api/buckets
- Before: Deletes any bucket by id
- After: Deletes only if `bucket.user_id = currentUser.id`

### GET /api/checkins
- Before: Returns entries with bucket_id
- After: Also returns per-user bucket lists so frontend can show friend's habits

---

## Frontend UI Changes

### Settings Tab (for all users)
- "Manage Your Habits" section
- List of user's buckets with inline edit
- Add new bucket button (disabled if at 5)
- Delete button per bucket (with confirmation)

### Check-in Tab
- No changes to checkbox rendering (uses user's own buckets)

### Friends Section
- Progress: "2/4" where 4 is friend's bucket count
- Tooltip: Shows friend's bucket names, not yours

### Heatmap
- Tooltip for friend's day: Shows their bucket names

---

## Risk Mitigation

1. **Data loss prevention**: Migration copies buckets, doesn't delete until copies verified
2. **Rollback**: Keep migration idempotent - can re-run safely
3. **Gradual rollout**: Migration runs in ensureSchema(), tested locally first

---

## Notes

- Max 5 buckets per user (enforced in API)
- Bucket names unique per user (can have same name as another user)
- Deleting a bucket cascades to delete all entries for that bucket
- **Migrations run via `npm run db:migrate`**, not on every request
- `ensureSchema()` only verifies tables exist, throws if schema missing
