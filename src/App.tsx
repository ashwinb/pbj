import { useCallback, useEffect, useMemo, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import './App.css'
import { formatMonth, todayISO } from './dateUtils'

// Epoch date - dates before this are grayed out and don't count toward stats
// In dev mode, use an old date so all test data is visible
const EPOCH_DATE = import.meta.env.VITE_DEV_AUTH === 'true' ? '2000-01-01' : '2026-01-18'

const MAX_BUCKETS = 5

type User = {
  id: number
  name: string
  email: string
  image: string | null
}

type Bucket = {
  id: number
  userId: number
  name: string
  sortOrder: number
}

type Entry = {
  userId: number
  bucketId: number
  date: string
  checked: boolean
}

type UserNote = {
  userId: number
  date: string
  notes: string
}

type View = 'today' | 'stats' | 'settings'

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || 'Request failed')
  }
  return response.json()
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [allBuckets, setAllBuckets] = useState<Bucket[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [userNotes, setUserNotes] = useState<UserNote[]>([])
  const [month, setMonth] = useState(formatMonth(new Date()))
  const [newBucket, setNewBucket] = useState('')
  const [bucketEdits, setBucketEdits] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMonth, setLoadingMonth] = useState(false)
  const [savingBuckets, setSavingBuckets] = useState<Set<number>>(new Set())
  const [view, setView] = useState<View>('stats')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string[]; note?: string } | null>(null)
  const [devEmail, setDevEmail] = useState('')

  // Auto-clear status messages after 3 seconds
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 3000)
    return () => clearTimeout(timer)
  }, [status])

  const isDevMode = import.meta.env.VITE_DEV_AUTH === 'true'

  const today = todayISO()
  const [selectedDate, setSelectedDate] = useState(today)
  const [noteInput, setNoteInput] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  // Current user's buckets
  const buckets = useMemo(() => {
    if (!user) return []
    return allBuckets.filter(b => b.userId === user.id)
  }, [allBuckets, user])

  // Get buckets for a specific user
  const getBucketsForUser = useCallback((userId: number) => {
    return allBuckets.filter(b => b.userId === userId)
  }, [allBuckets])

  // Dates that can be edited: today, yesterday, day before yesterday
  const editableDates = useMemo(() => {
    const dates: { date: string; label: string }[] = []
    const labels = ['Today', 'Yesterday', '2 days ago']
    for (let i = 0; i < 3; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      dates.push({
        date: dateStr,
        label: labels[i],
      })
    }
    return dates
  }, [])

  const loadCheckins = useCallback(
    async (monthValue: string) => {
      setLoadingMonth(true)
      try {
        const result = await fetchJson<{ users: User[]; entries: Entry[]; notes: UserNote[]; buckets: Bucket[] }>(
          `/api/checkins?month=${monthValue}`
        )
        setUsers(result.users)
        setEntries(result.entries)
        setUserNotes(result.notes)
        setAllBuckets(result.buckets)
        // Update bucket edits for current user's buckets
        if (user) {
          const myBuckets = result.buckets.filter(b => b.userId === user.id)
          setBucketEdits(
            myBuckets.reduce<Record<number, string>>((acc, bucket) => {
              acc[bucket.id] = bucket.name
              return acc
            }, {})
          )
        }
      } finally {
        setLoadingMonth(false)
      }
    },
    [user]
  )

  const reloadAll = useCallback(async () => {
    if (!user) return
    await loadCheckins(month)
  }, [loadCheckins, month, user])

  useEffect(() => {
    const init = async () => {
      try {
        const result = await fetchJson<{ user: User | null; isAdmin: boolean }>(
          '/api/auth/me'
        )
        setUser(result.user)
        setIsAdmin(result.isAdmin)

        // If user is logged in, load data before showing UI
        if (result.user) {
          const checkinsResult = await fetchJson<{ users: User[]; entries: Entry[]; notes: UserNote[]; buckets: Bucket[] }>(`/api/checkins?month=${month}`)
          setUsers(checkinsResult.users)
          setEntries(checkinsResult.entries)
          setUserNotes(checkinsResult.notes)
          setAllBuckets(checkinsResult.buckets)
          const myBuckets = checkinsResult.buckets.filter(b => b.userId === result.user!.id)
          setBucketEdits(
            myBuckets.reduce<Record<number, string>>((acc, bucket) => {
              acc[bucket.id] = bucket.name
              return acc
            }, {})
          )
        }
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  // Reload data when month changes (but not on initial mount - that's handled in init)
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  useEffect(() => {
    if (!user || !initialLoadDone) return
    setTooltip(null)
    void loadCheckins(month)
  }, [month, loadCheckins, user, initialLoadDone])

  // Mark initial load as done after first render with data
  useEffect(() => {
    if (!loading && user) {
      setInitialLoadDone(true)
    }
  }, [loading, user])

  const handleLogin = async (credential: string) => {
    setStatus(null)
    setLoading(true)
    try {
      await fetchJson('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      })
      const result = await fetchJson<{ user: User | null; isAdmin: boolean }>(
        '/api/auth/me'
      )
      setUser(result.user)
      setIsAdmin(result.isAdmin)

      if (result.user) {
        const checkinsResult = await fetchJson<{ users: User[]; entries: Entry[]; notes: UserNote[]; buckets: Bucket[] }>(`/api/checkins?month=${month}`)
        setUsers(checkinsResult.users)
        setEntries(checkinsResult.entries)
        setUserNotes(checkinsResult.notes)
        setAllBuckets(checkinsResult.buckets)
        const myBuckets = checkinsResult.buckets.filter(b => b.userId === result.user!.id)
        setBucketEdits(
          myBuckets.reduce<Record<number, string>>((acc, bucket) => {
            acc[bucket.id] = bucket.name
            return acc
          }, {})
        )
        setInitialLoadDone(true)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    setStatus(null)
    await fetchJson('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setIsAdmin(false)
    setAllBuckets([])
    setUsers([])
    setEntries([])
    setUserNotes([])
  }

  const handleDevLogin = async (email: string) => {
    setStatus(null)
    setLoading(true)
    try {
      await fetchJson('/api/auth/dev-login', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      const result = await fetchJson<{ user: User | null; isAdmin: boolean }>(
        '/api/auth/me'
      )
      setUser(result.user)
      setIsAdmin(result.isAdmin)

      if (result.user) {
        const checkinsResult = await fetchJson<{ users: User[]; entries: Entry[]; notes: UserNote[]; buckets: Bucket[] }>(`/api/checkins?month=${month}`)
        setUsers(checkinsResult.users)
        setEntries(checkinsResult.entries)
        setUserNotes(checkinsResult.notes)
        setAllBuckets(checkinsResult.buckets)
        const myBuckets = checkinsResult.buckets.filter(b => b.userId === result.user!.id)
        setBucketEdits(
          myBuckets.reduce<Record<number, string>>((acc, bucket) => {
            acc[bucket.id] = bucket.name
            return acc
          }, {})
        )
        setInitialLoadDone(true)
      }
    } catch {
      setStatus('Dev login failed')
    } finally {
      setLoading(false)
    }
  }

  const [bucketSaving, setBucketSaving] = useState<number | 'add' | null>(null)

  const handleBucketAdd = async () => {
    if (!newBucket.trim()) return
    setBucketSaving('add')
    setStatus(null)
    try {
      await fetchJson('/api/buckets', {
        method: 'POST',
        body: JSON.stringify({ name: newBucket.trim() }),
      })
      setNewBucket('')
      await reloadAll()
      setStatus('Habit added')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to add habit')
    } finally {
      setBucketSaving(null)
    }
  }

  const handleBucketSave = async (bucketId: number) => {
    const name = bucketEdits[bucketId]
    if (!name?.trim()) return
    setBucketSaving(bucketId)
    setStatus(null)
    try {
      await fetchJson('/api/buckets', {
        method: 'PUT',
        body: JSON.stringify({ id: bucketId, name: name.trim() }),
      })
      await reloadAll()
      setStatus('Habit updated')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to update habit')
    } finally {
      setBucketSaving(null)
    }
  }

  const handleBucketDelete = async (bucketId: number) => {
    if (!confirm('Delete this habit and all its check-in history?')) return
    setBucketSaving(bucketId)
    setStatus(null)
    try {
      await fetchJson('/api/buckets', {
        method: 'DELETE',
        body: JSON.stringify({ id: bucketId }),
      })
      await reloadAll()
      setStatus('Habit deleted')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to delete habit')
    } finally {
      setBucketSaving(null)
    }
  }

  const handleToggle = async (bucketId: number, checked: boolean) => {
    if (!user) return

    // Optimistically update local state
    setEntries(prev => {
      const existing = prev.find(
        e => e.userId === user.id && e.bucketId === bucketId && e.date === selectedDate
      )
      if (existing) {
        return prev.map(e =>
          e.userId === user.id && e.bucketId === bucketId && e.date === selectedDate
            ? { ...e, checked }
            : e
        )
      } else {
        return [...prev, { userId: user.id, bucketId, date: selectedDate, checked }]
      }
    })

    // Track saving state for this bucket
    setSavingBuckets(prev => new Set(prev).add(bucketId))

    try {
      await fetchJson('/api/checkins', {
        method: 'POST',
        body: JSON.stringify({ bucketId, checked, date: selectedDate }),
      })
    } catch {
      // On error, refetch to get correct state
      await loadCheckins(month)
    } finally {
      setSavingBuckets(prev => {
        const next = new Set(prev)
        next.delete(bucketId)
        return next
      })
    }
  }

  const handleSaveNote = async () => {
    if (!user) return
    if (noteInput === currentNote) return
    setSavingNote(true)
    try {
      await fetchJson('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ date: selectedDate, notes: noteInput }),
      })
      await loadCheckins(month)
    } finally {
      setSavingNote(false)
    }
  }

  const handleAdminReset = async () => {
    if (!confirm('Reset all buckets and check-ins for everyone?')) return
    await fetchJson('/api/admin/reset', { method: 'POST' })
    await reloadAll()
    setStatus('All data reset. Default buckets restored.')
  }

  // Calculate streak for current user
  const userStreak = useMemo(() => {
    if (!user || buckets.length === 0) return 0

    const userEntries = entries.filter(e => e.userId === user.id && e.checked)
    const userBucketIds = new Set(buckets.map(b => b.id))

    let streak = 0
    const date = new Date()

    // Check if today is complete (all of user's buckets checked)
    const todayStr = date.toISOString().slice(0, 10)
    const todayChecks = userEntries.filter(e => e.date === todayStr && userBucketIds.has(e.bucketId)).length
    const todayComplete = todayChecks >= buckets.length

    // Start from today if complete, otherwise yesterday
    if (!todayComplete) {
      date.setDate(date.getDate() - 1)
    }

    // Count consecutive days with all buckets complete
    while (true) {
      const dateStr = date.toISOString().slice(0, 10)
      const dayChecks = userEntries.filter(e => e.date === dateStr && userBucketIds.has(e.bucketId)).length
      if (dayChecks >= buckets.length) {
        streak++
        date.setDate(date.getDate() - 1)
      } else {
        break
      }
    }

    return streak
  }, [entries, user, buckets])

  // Check status for current user on selected date
  const userCheckedBuckets = useMemo(() => {
    if (!user) return new Set<number>()
    const dayEntries = entries.filter(
      e => e.userId === user.id && e.date === selectedDate && e.checked
    )
    return new Set(dayEntries.map(e => e.bucketId))
  }, [entries, user, selectedDate])

  // Get current user's note for selected date
  const currentNote = useMemo(() => {
    if (!user) return ''
    const note = userNotes.find(n => n.userId === user.id && n.date === selectedDate)
    return note?.notes || ''
  }, [userNotes, user, selectedDate])

  // Sync noteInput when date changes or notes load
  useEffect(() => {
    setNoteInput(currentNote)
  }, [currentNote])

  // Friends' status today - now with per-user bucket counts
  const friendsToday = useMemo(() => {
    return users.map(friend => {
      const friendBuckets = getBucketsForUser(friend.id)
      const friendEntries = entries.filter(
        e => e.userId === friend.id && e.date === today && e.checked
      )
      // Only count entries for buckets that still exist
      const friendBucketIds = new Set(friendBuckets.map(b => b.id))
      const checkedCount = friendEntries.filter(e => friendBucketIds.has(e.bucketId)).length
      return {
        ...friend,
        checked: checkedCount,
        total: friendBuckets.length,
        complete: friendBuckets.length > 0 && checkedCount >= friendBuckets.length,
      }
    })
  }, [users, entries, today, getBucketsForUser])

  // Stats data
  const daysInMonth = useMemo(() => {
    const [year, monthPart] = month.split('-').map(Number)
    return new Date(year, monthPart, 0).getDate()
  }, [month])

  // Count only active days (between epoch and today)
  const activeDaysInMonth = useMemo(() => {
    let count = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${month}-${String(day).padStart(2, '0')}`
      if (date >= EPOCH_DATE && date <= today) {
        count++
      }
    }
    return count
  }, [month, daysInMonth, today])

  // Monthly completion counts - now per-user bucket aware
  const monthlyCompletionCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const entry of entries) {
      if (!entry.checked) continue
      // Only count entries from active days
      if (entry.date < EPOCH_DATE || entry.date > today) continue
      // Verify the bucket still exists for this user
      const bucket = allBuckets.find(b => b.id === entry.bucketId)
      if (!bucket || bucket.userId !== entry.userId) continue
      map.set(entry.userId, (map.get(entry.userId) || 0) + 1)
    }
    return map
  }, [entries, today, allBuckets])

  // Total possible per user (their bucket count * active days)
  const getTotalPossibleForUser = useCallback((userId: number) => {
    const userBucketCount = getBucketsForUser(userId).length
    return userBucketCount * activeDaysInMonth
  }, [getBucketsForUser, activeDaysInMonth])

  const userDayCompletion = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of entries) {
      if (!entry.checked) continue
      // Verify bucket exists for user
      const bucket = allBuckets.find(b => b.id === entry.bucketId)
      if (!bucket || bucket.userId !== entry.userId) continue
      const key = `${entry.userId}-${entry.date}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }, [entries, allBuckets])

  const selectedDateFormatted = useMemo(() => {
    const [year, month, day] = selectedDate.split('-').map(Number)
    const d = new Date(year, month - 1, day)
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  }, [selectedDate])

  const completedToday = userCheckedBuckets.size
  const totalBuckets = buckets.length
  const allDone = completedToday >= totalBuckets && totalBuckets > 0

  if (loading) {
    return <div className="app-shell loading-screen">Loading...</div>
  }

  if (!user) {
    return (
      <div className="app-shell login-screen">
        <div className="login-card">
          <h1>Daily Habit Hub</h1>
          <p className="tagline">Four friends, one month of momentum.</p>
          {isDevMode ? (
            <div className="login-cta">
              <p>Dev Mode - Select a test user:</p>
              <div className="dev-login-options">
                {['alice@test.local', 'bob@test.local', 'carol@test.local', 'dan@test.local'].map(
                  (email) => (
                    <button
                      key={email}
                      className="dev-login-btn"
                      onClick={() => handleDevLogin(email)}
                    >
                      {email.split('@')[0]}
                    </button>
                  )
                )}
              </div>
              <div className="dev-login-custom">
                <input
                  type="email"
                  placeholder="Or enter custom email..."
                  value={devEmail}
                  onChange={(e) => setDevEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && devEmail && handleDevLogin(devEmail)}
                />
                <button
                  onClick={() => devEmail && handleDevLogin(devEmail)}
                  disabled={!devEmail}
                >
                  Login
                </button>
              </div>
            </div>
          ) : (
            <div className="login-cta">
              <p>Sign in to start tracking with your friends.</p>
              <GoogleLogin
                onSuccess={(credentialResponse) => {
                  if (credentialResponse.credential) {
                    void handleLogin(credentialResponse.credential)
                  }
                }}
                onError={() => setStatus('Google sign-in failed. Try again.')}
              />
            </div>
          )}
          {status && <div className="status-banner error">{status}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <span className="app-title">Daily Habit Hub</span>
          {userStreak > 0 && (
            <span className="streak-badge">🔥 {userStreak} day{userStreak > 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="header-right">
          <img
            src={user.image || 'https://placehold.co/40x40?text=👤'}
            alt={user.name}
            className="avatar-small"
          />
          <button className="btn-text" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      {status && <div className="status-banner">{status}</div>}

      {/* Navigation - Settings now available to all users */}
      <nav className="tab-bar">
        <button
          className={`tab ${view === 'stats' ? 'active' : ''}`}
          onClick={() => setView('stats')}
        >
          Overview
        </button>
        <button
          className={`tab ${view === 'today' ? 'active' : ''}`}
          onClick={() => setView('today')}
        >
          Check-in
        </button>
        <button
          className={`tab ${view === 'settings' ? 'active' : ''}`}
          onClick={() => setView('settings')}
        >
          Settings
        </button>
      </nav>

      {/* Today View */}
      {view === 'today' && (
        <main className="main-content">
          <section className="today-section">
            <h2 className="date-heading">{selectedDateFormatted}</h2>

            <div className="date-selector">
              {editableDates.map(({ date, label }) => (
                <button
                  key={date}
                  className={`date-btn ${date === selectedDate ? 'active' : ''}`}
                  onClick={() => setSelectedDate(date)}
                >
                  {label}
                </button>
              ))}
            </div>

            {allDone && (
              <div className="celebration">
                🎉 All done{selectedDate === today ? ' for today' : ''}!
              </div>
            )}

            <div className="checklist">
              {buckets.map((bucket) => {
                const isChecked = userCheckedBuckets.has(bucket.id)
                const isSaving = savingBuckets.has(bucket.id)
                return (
                  <label
                    key={bucket.id}
                    className={`check-item ${isChecked ? 'checked' : ''} ${isSaving ? 'saving' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => handleToggle(bucket.id, e.target.checked)}
                    />
                    <span className="check-label">{bucket.name}</span>
                    {isSaving && <span className="check-spinner" />}
                    {!isSaving && isChecked && <span className="check-mark">✓</span>}
                  </label>
                )
              })}
              {buckets.length === 0 && (
                <p className="empty-state">No habits set up yet. Go to Settings to add some!</p>
              )}
            </div>

            <div className="progress-ring">
              <span className="progress-text">
                {completedToday}/{totalBuckets}
              </span>
            </div>

            <div className="notes-section">
              <label htmlFor="day-notes">Notes for the day</label>
              <textarea
                id="day-notes"
                placeholder="How did it go? Any thoughts..."
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                disabled={savingNote}
                rows={3}
              />
              <div className="notes-actions">
                {noteInput !== currentNote && (
                  <button
                    className="btn-small btn-primary"
                    onClick={handleSaveNote}
                    disabled={savingNote}
                  >
                    {savingNote ? 'Saving...' : 'Save'}
                  </button>
                )}
                {noteInput === currentNote && currentNote && (
                  <span className="saved-indicator">Saved</span>
                )}
              </div>
            </div>
          </section>

          <section className="friends-section">
            <h3>Friends today</h3>
            <div className="friends-grid">
              {friendsToday.map((friend) => (
                <div
                  key={friend.id}
                  className={`friend-chip ${friend.complete ? 'complete' : ''} ${friend.id === user.id ? 'is-you' : ''}`}
                >
                  <img
                    src={friend.image || 'https://placehold.co/32x32?text=👤'}
                    alt={friend.name}
                  />
                  <span className="friend-name">{friend.name.split(' ')[0]}</span>
                  <span className="friend-score">
                    {friend.checked}/{friend.total}
                    {friend.complete && ' ✓'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </main>
      )}

      {/* Stats View */}
      {view === 'stats' && (
        <main className="main-content">
          {/* Today Strip */}
          <section className="today-strip">
            <h3>Today</h3>
            <div className="today-cards">
              {friendsToday.map((friend) => {
                const friendBuckets = getBucketsForUser(friend.id)
                const checkedBucketIds = new Set(
                  entries
                    .filter(e => e.userId === friend.id && e.date === today && e.checked)
                    .map(e => e.bucketId)
                )
                return (
                  <div
                    key={friend.id}
                    className={`today-card ${friend.complete ? 'complete' : ''} ${friend.id === user.id ? 'is-you' : ''}`}
                  >
                    <div className="today-card-header">
                      <img
                        src={friend.image || 'https://placehold.co/40x40?text=👤'}
                        alt={friend.name}
                      />
                      <span className="today-card-name">{friend.name.split(' ')[0]}</span>
                      {friend.complete && <span className="today-card-check">✓</span>}
                    </div>
                    <div className="today-card-buckets">
                      {friendBuckets.map((bucket) => (
                        <div
                          key={bucket.id}
                          className={`today-bucket ${checkedBucketIds.has(bucket.id) ? 'checked' : ''}`}
                        >
                          {checkedBucketIds.has(bucket.id) ? '✓' : '○'} {bucket.name}
                        </div>
                      ))}
                      {friendBuckets.length === 0 && (
                        <div className="today-bucket">No habits set up</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Monthly Stats */}
          <section className="stats-section">
            <div className="stats-header">
              <h2>Monthly Progress</h2>
              <div className="month-picker">
                <button
                  className="month-nav"
                  onClick={() => {
                    const [y, m] = month.split('-').map(Number)
                    const d = new Date(y, m - 2, 1)
                    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
                  }}
                >
                  &larr;
                </button>
                <span className="month-label">
                  {(() => {
                    const [y, m] = month.split('-').map(Number)
                    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                  })()}
                </span>
                <button
                  className="month-nav"
                  onClick={() => {
                    const [y, m] = month.split('-').map(Number)
                    const d = new Date(y, m, 1)
                    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
                  }}
                >
                  &rarr;
                </button>
              </div>
            </div>

            <div className={`stats-grid ${loadingMonth ? 'loading' : ''}`}>
              {users.map((friend) => {
                const friendBuckets = getBucketsForUser(friend.id)
                const completedCount = monthlyCompletionCounts.get(friend.id) || 0
                const totalPossible = getTotalPossibleForUser(friend.id)
                const percent = totalPossible
                  ? Math.round((completedCount / totalPossible) * 100)
                  : 0

                return (
                  <div key={friend.id} className="stat-card">
                    <div className="stat-card-header">
                      <img
                        src={friend.image || 'https://placehold.co/48x48?text=👤'}
                        alt={friend.name}
                      />
                      <div>
                        <strong>{friend.name}</strong>
                        <span className="stat-percent">{percent}%</span>
                      </div>
                    </div>
                    <div className="heatmap">
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const day = i + 1
                        const date = `${month}-${String(day).padStart(2, '0')}`
                        const isFuture = date > today
                        const isBeforeEpoch = date < EPOCH_DATE
                        const isInactive = isFuture || isBeforeEpoch
                        const count = userDayCompletion.get(`${friend.id}-${date}`) || 0
                        const intensity = friendBuckets.length ? count / friendBuckets.length : 0
                        const checkedBucketIds = new Set(
                          entries
                            .filter(e => e.userId === friend.id && e.date === date && e.checked)
                            .map(e => e.bucketId)
                        )
                        // Show friend's bucket names in tooltip
                        const checkedNames = friendBuckets
                          .filter(b => checkedBucketIds.has(b.id))
                          .map(b => `✓ ${b.name}`)
                        const uncheckedNames = friendBuckets
                          .filter(b => !checkedBucketIds.has(b.id))
                          .map(b => `○ ${b.name}`)
                        const friendNote = userNotes.find(n => n.userId === friend.id && n.date === date)
                        const tooltipContent = [
                          date,
                          ...checkedNames,
                          ...uncheckedNames,
                        ]

                        let bg = 'var(--border)'
                        if (!isInactive && !loadingMonth) {
                          if (intensity === 1) {
                            bg = 'var(--accent)' // green - all done
                          } else if (intensity >= 0.5) {
                            bg = '#84cc16' // lime - more than half
                          } else if (intensity > 0) {
                            bg = '#f97316' // orange - less than half
                          } else {
                            bg = '#ef4444' // red - nothing done
                          }
                        }

                        return (
                          <div
                            key={date}
                            className={`heat-cell ${isInactive ? 'future' : ''} ${loadingMonth ? 'loading' : ''}`}
                            style={{
                              opacity: isInactive ? 0.3 : (loadingMonth ? 0.5 : (0.4 + intensity * 0.6)),
                              background: bg,
                            }}
                            onMouseEnter={isInactive || loadingMonth ? undefined : (e) => {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setTooltip({
                                x: rect.left + rect.width / 2,
                                y: rect.top,
                                content: tooltipContent,
                                note: friendNote?.notes,
                              })
                            }}
                            onMouseLeave={isInactive || loadingMonth ? undefined : () => setTooltip(null)}
                          >
                            {day}
                          </div>
                        )
                      })}
                    </div>
                    <div className="stat-summary">
                      <span>{completedCount} checkmarks</span>
                      <span>{activeDaysInMonth > 0 ? (completedCount / activeDaysInMonth).toFixed(1) : '0'} / day avg</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </main>
      )}

      {/* Settings View - Available to all users */}
      {view === 'settings' && (
        <main className="main-content">
          <section className="settings-section">
            <h2>Manage Your Habits</h2>
            <p className="settings-note">You can track up to {MAX_BUCKETS} habits.</p>

            <div className="bucket-list">
              {buckets.map((bucket) => (
                <div key={bucket.id} className="bucket-row">
                  <input
                    value={bucketEdits[bucket.id] || ''}
                    onChange={(e) =>
                      setBucketEdits((prev) => ({
                        ...prev,
                        [bucket.id]: e.target.value,
                      }))
                    }
                    className="bucket-input"
                    disabled={bucketSaving !== null}
                  />
                  <div className="bucket-actions">
                    <button
                      className="btn-small"
                      onClick={() => handleBucketSave(bucket.id)}
                      disabled={bucketSaving !== null}
                    >
                      {bucketSaving === bucket.id ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      className="btn-small btn-danger"
                      onClick={() => handleBucketDelete(bucket.id)}
                      disabled={bucketSaving !== null}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {buckets.length < MAX_BUCKETS && (
                <div className="bucket-row add-row">
                  <input
                    placeholder="New habit name..."
                    value={newBucket}
                    onChange={(e) => setNewBucket(e.target.value)}
                    className="bucket-input"
                    onKeyDown={(e) => e.key === 'Enter' && handleBucketAdd()}
                    disabled={bucketSaving !== null}
                  />
                  <button
                    className="btn-small btn-primary"
                    onClick={handleBucketAdd}
                    disabled={bucketSaving !== null}
                  >
                    {bucketSaving === 'add' ? 'Adding...' : 'Add'}
                  </button>
                </div>
              )}
              {buckets.length >= MAX_BUCKETS && (
                <p className="bucket-limit-note">Maximum {MAX_BUCKETS} habits reached.</p>
              )}
            </div>

            {isAdmin && (
              <div className="danger-zone">
                <h3>Danger Zone</h3>
                <p>Reset all data and restore default habits for everyone.</p>
                <button className="btn-danger" onClick={handleAdminReset}>
                  Reset All Data
                </button>
              </div>
            )}
          </section>
        </main>
      )}

      {tooltip && (
        <div
          className="heatmap-tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y,
          }}
        >
          {tooltip.content.map((line, i) => (
            <div key={i} className={i === 0 ? 'tooltip-date' : undefined}>
              {line}
            </div>
          ))}
          {tooltip.note && (
            <div className="tooltip-note">"{tooltip.note}"</div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
