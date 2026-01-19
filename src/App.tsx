import { useCallback, useEffect, useMemo, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import './App.css'
import { formatMonth, todayISO } from './dateUtils'

// Epoch date - dates before this are grayed out and don't count toward stats
// In dev mode, use an old date so all test data is visible
const EPOCH_DATE = import.meta.env.VITE_DEV_AUTH === 'true' ? '2000-01-01' : '2026-01-18'

type User = {
  id: number
  name: string
  email: string
  image: string | null
}

type Bucket = {
  id: number
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
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [userNotes, setUserNotes] = useState<UserNote[]>([])
  const [month, setMonth] = useState(formatMonth(new Date()))
  const [newBucket, setNewBucket] = useState('')
  const [bucketEdits, setBucketEdits] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMonth, setLoadingMonth] = useState(false)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<View>('stats')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string[] } | null>(null)
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

  const loadBuckets = useCallback(async () => {
    const result = await fetchJson<{ buckets: Bucket[] }>('/api/buckets')
    setBuckets(result.buckets)
    setBucketEdits(
      result.buckets.reduce<Record<number, string>>((acc, bucket) => {
        acc[bucket.id] = bucket.name
        return acc
      }, {})
    )
  }, [])

  const loadCheckins = useCallback(
    async (monthValue: string) => {
      setLoadingMonth(true)
      try {
        const result = await fetchJson<{ users: User[]; entries: Entry[]; notes: UserNote[] }>(
          `/api/checkins?month=${monthValue}`
        )
        setUsers(result.users)
        setEntries(result.entries)
        setUserNotes(result.notes)
      } finally {
        setLoadingMonth(false)
      }
    },
    []
  )

  const reloadAll = useCallback(async () => {
    if (!user) return
    await Promise.all([loadBuckets(), loadCheckins(month)])
  }, [loadBuckets, loadCheckins, month, user])

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
          const [bucketsResult, checkinsResult] = await Promise.all([
            fetchJson<{ buckets: Bucket[] }>('/api/buckets'),
            fetchJson<{ users: User[]; entries: Entry[]; notes: UserNote[] }>(`/api/checkins?month=${month}`),
          ])
          setBuckets(bucketsResult.buckets)
          setBucketEdits(
            bucketsResult.buckets.reduce<Record<number, string>>((acc, bucket) => {
              acc[bucket.id] = bucket.name
              return acc
            }, {})
          )
          setUsers(checkinsResult.users)
          setEntries(checkinsResult.entries)
          setUserNotes(checkinsResult.notes)
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
        const [bucketsResult, checkinsResult] = await Promise.all([
          fetchJson<{ buckets: Bucket[] }>('/api/buckets'),
          fetchJson<{ users: User[]; entries: Entry[]; notes: UserNote[] }>(`/api/checkins?month=${month}`),
        ])
        setBuckets(bucketsResult.buckets)
        setBucketEdits(
          bucketsResult.buckets.reduce<Record<number, string>>((acc, bucket) => {
            acc[bucket.id] = bucket.name
            return acc
          }, {})
        )
        setUsers(checkinsResult.users)
        setEntries(checkinsResult.entries)
        setUserNotes(checkinsResult.notes)
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
    setBuckets([])
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
        const [bucketsResult, checkinsResult] = await Promise.all([
          fetchJson<{ buckets: Bucket[] }>('/api/buckets'),
          fetchJson<{ users: User[]; entries: Entry[]; notes: UserNote[] }>(`/api/checkins?month=${month}`),
        ])
        setBuckets(bucketsResult.buckets)
        setBucketEdits(
          bucketsResult.buckets.reduce<Record<number, string>>((acc, bucket) => {
            acc[bucket.id] = bucket.name
            return acc
          }, {})
        )
        setUsers(checkinsResult.users)
        setEntries(checkinsResult.entries)
        setUserNotes(checkinsResult.notes)
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
      await loadBuckets()
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
      await loadBuckets()
      setStatus('Habit updated')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to update habit')
    } finally {
      setBucketSaving(null)
    }
  }

  const handleBucketDelete = async (bucketId: number) => {
    if (!confirm('Delete this bucket and its history for everyone?')) return
    setBucketSaving(bucketId)
    setStatus(null)
    try {
      await fetchJson('/api/buckets', {
        method: 'DELETE',
        body: JSON.stringify({ id: bucketId }),
      })
      await loadBuckets()
      await loadCheckins(month)
      setStatus('Habit deleted')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to delete habit')
    } finally {
      setBucketSaving(null)
    }
  }

  const handleToggle = async (bucketId: number, checked: boolean) => {
    if (!user) return
    setSaving(true)
    try {
      await fetchJson('/api/checkins', {
        method: 'POST',
        body: JSON.stringify({ bucketId, checked, date: selectedDate }),
      })
      await loadCheckins(month)
    } finally {
      setSaving(false)
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

    let streak = 0
    const date = new Date()

    // Check if today is complete (all buckets checked)
    const todayStr = date.toISOString().slice(0, 10)
    const todayChecks = userEntries.filter(e => e.date === todayStr).length
    const todayComplete = todayChecks >= buckets.length

    // Start from today if complete, otherwise yesterday
    if (!todayComplete) {
      date.setDate(date.getDate() - 1)
    }

    // Count consecutive days with all buckets complete
    while (true) {
      const dateStr = date.toISOString().slice(0, 10)
      const dayChecks = userEntries.filter(e => e.date === dateStr).length
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

  // Friends' status today
  const friendsToday = useMemo(() => {
    return users.map(friend => {
      const friendEntries = entries.filter(
        e => e.userId === friend.id && e.date === today && e.checked
      )
      return {
        ...friend,
        checked: friendEntries.length,
        total: buckets.length,
        complete: friendEntries.length >= buckets.length,
      }
    })
  }, [users, entries, today, buckets])

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

  const totalPossible = buckets.length * activeDaysInMonth

  const monthlyCompletionCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const entry of entries) {
      if (!entry.checked) continue
      // Only count entries from active days
      if (entry.date < EPOCH_DATE || entry.date > today) continue
      map.set(entry.userId, (map.get(entry.userId) || 0) + 1)
    }
    return map
  }, [entries, today])

  const userDayCompletion = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of entries) {
      if (!entry.checked) continue
      const key = `${entry.userId}-${entry.date}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }, [entries])

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

      {/* Navigation */}
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
        {isAdmin && (
          <button
            className={`tab ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        )}
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
                return (
                  <label
                    key={bucket.id}
                    className={`check-item ${isChecked ? 'checked' : ''} ${saving ? 'saving' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => handleToggle(bucket.id, e.target.checked)}
                      disabled={saving}
                    />
                    <span className="check-label">{bucket.name}</span>
                    {isChecked && <span className="check-mark">✓</span>}
                  </label>
                )
              })}
              {buckets.length === 0 && (
                <p className="empty-state">No habits set up yet. Ask an admin to add some!</p>
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
                onBlur={handleSaveNote}
                disabled={savingNote}
                rows={3}
              />
              {savingNote && <span className="saving-indicator">Saving...</span>}
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
                      {buckets.map((bucket) => (
                        <div
                          key={bucket.id}
                          className={`today-bucket ${checkedBucketIds.has(bucket.id) ? 'checked' : ''}`}
                        >
                          {checkedBucketIds.has(bucket.id) ? '✓' : '○'} {bucket.name}
                        </div>
                      ))}
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
                const completedCount = monthlyCompletionCounts.get(friend.id) || 0
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
                        const intensity = buckets.length ? count / buckets.length : 0
                        const checkedBucketIds = new Set(
                          entries
                            .filter(e => e.userId === friend.id && e.date === date && e.checked)
                            .map(e => e.bucketId)
                        )
                        const checkedNames = buckets
                          .filter(b => checkedBucketIds.has(b.id))
                          .map(b => `✓ ${b.name}`)
                        const uncheckedNames = buckets
                          .filter(b => !checkedBucketIds.has(b.id))
                          .map(b => `○ ${b.name}`)
                        const friendNote = userNotes.find(n => n.userId === friend.id && n.date === date)
                        const tooltipContent = [
                          date,
                          ...checkedNames,
                          ...uncheckedNames,
                          ...(friendNote?.notes ? ['', `"${friendNote.notes}"`] : []),
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

      {/* Settings View (Admin Only) */}
      {view === 'settings' && isAdmin && (
        <main className="main-content">
          <section className="settings-section">
            <h2>Manage Habits</h2>
            <p className="settings-note">Changes affect all users.</p>

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
            </div>

            <div className="danger-zone">
              <h3>Danger Zone</h3>
              <p>Reset all data and restore default habits.</p>
              <button className="btn-danger" onClick={handleAdminReset}>
                Reset All Data
              </button>
            </div>
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
        </div>
      )}
    </div>
  )
}

export default App
