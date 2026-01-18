import { useCallback, useEffect, useMemo, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import './App.css'
import { formatMonth, todayISO } from './dateUtils'

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
  const [month, setMonth] = useState(formatMonth(new Date()))
  const [newBucket, setNewBucket] = useState('')
  const [bucketEdits, setBucketEdits] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<View>('stats')

  const today = todayISO()

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
      const result = await fetchJson<{ users: User[]; entries: Entry[] }>(
        `/api/checkins?month=${monthValue}`
      )
      setUsers(result.users)
      setEntries(result.entries)
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
            fetchJson<{ users: User[]; entries: Entry[] }>(`/api/checkins?month=${month}`),
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
          fetchJson<{ users: User[]; entries: Entry[] }>(`/api/checkins?month=${month}`),
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
  }

  const handleBucketAdd = async () => {
    if (!newBucket.trim()) return
    await fetchJson('/api/buckets', {
      method: 'POST',
      body: JSON.stringify({ name: newBucket.trim() }),
    })
    setNewBucket('')
    await loadBuckets()
  }

  const handleBucketSave = async (bucketId: number) => {
    const name = bucketEdits[bucketId]
    if (!name?.trim()) return
    await fetchJson('/api/buckets', {
      method: 'PUT',
      body: JSON.stringify({ id: bucketId, name: name.trim() }),
    })
    await loadBuckets()
  }

  const handleBucketDelete = async (bucketId: number) => {
    if (!confirm('Delete this bucket and its history for everyone?')) return
    await fetchJson('/api/buckets', {
      method: 'DELETE',
      body: JSON.stringify({ id: bucketId }),
    })
    await loadBuckets()
    await loadCheckins(month)
  }

  const handleToggle = async (bucketId: number, checked: boolean) => {
    if (!user) return
    setSaving(true)
    try {
      await fetchJson('/api/checkins', {
        method: 'POST',
        body: JSON.stringify({ bucketId, checked, date: today }),
      })
      await loadCheckins(month)
    } finally {
      setSaving(false)
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

  // Today's check status for current user
  const userCheckedBuckets = useMemo(() => {
    if (!user) return new Set<number>()
    const todayEntries = entries.filter(
      e => e.userId === user.id && e.date === today && e.checked
    )
    return new Set(todayEntries.map(e => e.bucketId))
  }, [entries, user, today])

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

  const totalPossible = buckets.length * daysInMonth

  const monthlyCompletionCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const entry of entries) {
      if (!entry.checked) continue
      map.set(entry.userId, (map.get(entry.userId) || 0) + 1)
    }
    return map
  }, [entries])

  const userDayCompletion = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of entries) {
      if (!entry.checked) continue
      const key = `${entry.userId}-${entry.date}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }, [entries])

  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

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
            <h2 className="date-heading">{todayFormatted}</h2>

            {allDone && (
              <div className="celebration">
                🎉 All done for today!
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
          <section className="stats-section">
            <div className="stats-header">
              <div>
                <p className="section-eyebrow">Friends overview</p>
                <h2>How everyone is doing</h2>
              </div>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="month-picker"
              />
            </div>

            <div className="overview-grid">
              {friendsToday.map((friend) => {
                const completedCount = monthlyCompletionCounts.get(friend.id) || 0
                const percent = totalPossible
                  ? Math.round((completedCount / totalPossible) * 100)
                  : 0

                return (
                  <div
                    key={friend.id}
                    className={`overview-card ${friend.complete ? 'complete' : ''} ${
                      friend.id === user.id ? 'is-you' : ''
                    }`}
                  >
                    <div className="overview-card-header">
                      <img
                        src={friend.image || 'https://placehold.co/48x48?text=👤'}
                        alt={friend.name}
                      />
                      <div>
                        <strong>{friend.name}</strong>
                        <span className="overview-subtitle">Today&apos;s progress</span>
                      </div>
                    </div>
                    <div className="overview-metrics">
                      <div>
                        <span className="metric-label">Today</span>
                        <span className="metric-value">
                          {friend.checked}/{friend.total}
                        </span>
                      </div>
                      <div>
                        <span className="metric-label">Month</span>
                        <span className="metric-value">{percent}%</span>
                      </div>
                    </div>
                    <div className="overview-progress">
                      <span
                        style={{
                          width: `${friend.total ? (friend.checked / friend.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="stats-grid">
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
                        const count = userDayCompletion.get(`${friend.id}-${date}`) || 0
                        const intensity = buckets.length ? count / buckets.length : 0
                        return (
                          <div
                            key={date}
                            className="heat-cell"
                            style={{
                              opacity: 0.2 + intensity * 0.8,
                              background: intensity > 0 ? 'var(--accent)' : 'var(--border)',
                            }}
                            title={`${date}: ${count}/${buckets.length}`}
                          >
                            {day}
                          </div>
                        )
                      })}
                    </div>
                    <div className="stat-summary">
                      <span>{completedCount} checkmarks</span>
                      <span>{(completedCount / daysInMonth).toFixed(1)} / day avg</span>
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
                  />
                  <div className="bucket-actions">
                    <button className="btn-small" onClick={() => handleBucketSave(bucket.id)}>
                      Save
                    </button>
                    <button
                      className="btn-small btn-danger"
                      onClick={() => handleBucketDelete(bucket.id)}
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
                />
                <button className="btn-small btn-primary" onClick={handleBucketAdd}>
                  Add
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
    </div>
  )
}

export default App
