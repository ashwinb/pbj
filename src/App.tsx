import { useCallback, useEffect, useMemo, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import './App.css'
import { daysInMonth, formatMonth, monthLabel, todayISO } from './dateUtils'

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

const formatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
})

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
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [month, setMonth] = useState(formatMonth(new Date()))
  const [newBucket, setNewBucket] = useState('')
  const [bucketEdits, setBucketEdits] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadUser = useCallback(async () => {
    const result = await fetchJson<{ user: User | null; isAdmin: boolean }>(
      '/api/auth/me'
    )
    setUser(result.user)
    setIsAdmin(result.isAdmin)
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
        await loadUser()
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [loadUser])

  useEffect(() => {
    if (!user) return
    void reloadAll()
  }, [user, reloadAll])

  useEffect(() => {
    if (!user) return
    void loadCheckins(month)
  }, [month, loadCheckins, user])

  const handleLogin = async (credential: string) => {
    setStatus(null)
    await fetchJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    })
    await loadUser()
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
    if (!confirm('Delete this bucket and its history?')) return
    await fetchJson('/api/buckets', {
      method: 'DELETE',
      body: JSON.stringify({ id: bucketId }),
    })
    await loadBuckets()
    await loadCheckins(month)
  }

  const handleToggle = async (bucketId: number, checked: boolean) => {
    if (!user) return
    await fetchJson('/api/checkins', {
      method: 'POST',
      body: JSON.stringify({ bucketId, checked, date: selectedDate }),
    })
    await loadCheckins(month)
  }

  const handleAdminReset = async () => {
    if (!confirm('Reset all buckets and check-ins for everyone?')) return
    await fetchJson('/api/admin/reset', { method: 'POST' })
    await reloadAll()
    setStatus('All data reset. Default buckets restored.')
  }

  const entriesByUser = useMemo(() => {
    return entries.reduce<Record<number, Entry[]>>((acc, entry) => {
      acc[entry.userId] = acc[entry.userId] || []
      acc[entry.userId].push(entry)
      return acc
    }, {})
  }, [entries])

  const bucketCount = buckets.length
  const totalDays = daysInMonth(month)

  const userDayCompletion = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of entries) {
      if (!entry.checked) continue
      const key = `${entry.userId}-${entry.date}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }, [entries])

  const perBucketStats = useMemo(() => {
    const stats: Record<number, Record<number, number>> = {}
    for (const bucket of buckets) {
      stats[bucket.id] = {}
    }
    for (const entry of entries) {
      if (!entry.checked) continue
      stats[entry.bucketId] = stats[entry.bucketId] || {}
      stats[entry.bucketId][entry.userId] = (stats[entry.bucketId][entry.userId] || 0) + 1
    }
    return stats
  }, [entries, buckets])

  const userEntriesForDate = useMemo(() => {
    if (!user) return []
    return entries.filter((entry) => entry.userId === user.id && entry.date === selectedDate)
  }, [entries, user, selectedDate])

  const userCheckedBuckets = useMemo(() => {
    return new Set(userEntriesForDate.filter((entry) => entry.checked).map((entry) => entry.bucketId))
  }, [userEntriesForDate])

  if (loading) {
    return <div className="app-shell">Loading...</div>
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Daily Habit Hub</p>
          <h1>Four friends, one month of momentum.</h1>
          <p className="subtitle">
            Check in daily, adjust the regimen as you go, and celebrate the streaks together.
          </p>
        </div>
        <div className="auth-card">
          {user ? (
            <div className="user-info">
              <img
                src={user.image || 'https://placehold.co/80x80?text=🙂'}
                alt={user.name}
              />
              <div>
                <strong>{user.name}</strong>
                <p>{user.email}</p>
              </div>
              <button className="secondary" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="login-panel">
              <p>Sign in with Google to start tracking together.</p>
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
        </div>
      </header>

      {status && <div className="status-banner">{status}</div>}

      {!user ? (
        <section className="callout">
          <h2>What you can do</h2>
          <ul>
            <li>Track daily exercise buckets with one tap.</li>
            <li>Refine the regimen together as you iterate.</li>
            <li>Review progress by day, bucket, and friend.</li>
          </ul>
        </section>
      ) : (
        <>
          <section className="section-grid">
            <div className="card">
              <div className="card-header">
                <h2>Today&apos;s check-in</h2>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
              </div>
              <div className="checklist">
                {buckets.map((bucket) => (
                  <label key={bucket.id} className="check-item">
                    <input
                      type="checkbox"
                      checked={userCheckedBuckets.has(bucket.id)}
                      onChange={(event) => handleToggle(bucket.id, event.target.checked)}
                    />
                    <span>{bucket.name}</span>
                  </label>
                ))}
                {buckets.length === 0 && <p>No buckets yet. Add one below.</p>}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2>Regimen buckets</h2>
              </div>
              <div className="bucket-list">
                {buckets.map((bucket) => (
                  <div key={bucket.id} className="bucket-row">
                    <input
                      value={bucketEdits[bucket.id] || ''}
                      onChange={(event) =>
                        setBucketEdits((prev) => ({
                          ...prev,
                          [bucket.id]: event.target.value,
                        }))
                      }
                    />
                    <div className="bucket-actions">
                      <button onClick={() => handleBucketSave(bucket.id)}>Save</button>
                      <button className="secondary" onClick={() => handleBucketDelete(bucket.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                <div className="bucket-row add-row">
                  <input
                    placeholder="Add a new bucket"
                    value={newBucket}
                    onChange={(event) => setNewBucket(event.target.value)}
                  />
                  <button onClick={handleBucketAdd}>Add</button>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2>Monthly progress</h2>
                <p className="muted">{monthLabel(month)}</p>
              </div>
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </div>

            <div className="progress-grid">
              {users.map((friend) => {
                const friendEntries = entriesByUser[friend.id] || []
                const completedCount = friendEntries.filter((entry) => entry.checked).length
                const totalPossible = bucketCount * totalDays
                const percent = totalPossible ? Math.round((completedCount / totalPossible) * 100) : 0

                return (
                  <div key={friend.id} className="friend-card">
                    <div className="friend-header">
                      <img
                        src={friend.image || 'https://placehold.co/64x64?text=🙂'}
                        alt={friend.name}
                      />
                      <div>
                        <strong>{friend.name}</strong>
                        <p>{percent}% completed</p>
                      </div>
                    </div>

                    <div className="heatmap">
                      {Array.from({ length: totalDays }).map((_, index) => {
                        const day = index + 1
                        const date = `${month}-${String(day).padStart(2, '0')}`
                        const count = userDayCompletion.get(`${friend.id}-${date}`) || 0
                        const intensity = bucketCount ? count / bucketCount : 0
                        const shade = Math.min(1, intensity)
                        const style = {
                          background: `rgba(14, 116, 144, ${0.15 + shade * 0.65})`,
                        }
                        return (
                          <div key={date} className="heat-cell" style={style}>
                            <span>{day}</span>
                          </div>
                        )
                      })}
                    </div>

                    <div className="friend-summary">
                      <div>
                        <span className="label">Total checkmarks</span>
                        <strong>{completedCount}</strong>
                      </div>
                      <div>
                        <span className="label">Daily average</span>
                        <strong>
                          {totalDays ? (completedCount / totalDays).toFixed(1) : '0.0'}
                        </strong>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Per-bucket stats</h2>
            </div>
            <div className="bucket-stats">
              {buckets.map((bucket) => (
                <div key={bucket.id} className="bucket-stat-card">
                  <h3>{bucket.name}</h3>
                  <div className="stat-list">
                    {users.map((friend) => (
                      <div key={friend.id} className="stat-row">
                        <span>{friend.name}</span>
                        <strong>{perBucketStats[bucket.id]?.[friend.id] || 0}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Weekly cadence</h2>
              <p className="muted">A quick glance at check-ins for {formatter.format(new Date())}.</p>
            </div>
            <div className="week-grid">
              {Array.from({ length: 7 }).map((_, index) => {
                const date = new Date()
                date.setDate(date.getDate() - (6 - index))
                const dateStr = date.toISOString().slice(0, 10)
                return (
                  <div key={dateStr} className="week-cell">
                    <span>{weekdayFormatter.format(date)}</span>
                    <strong>{formatter.format(date)}</strong>
                    <div className="week-entries">
                      {users.map((friend) => {
                        const count = userDayCompletion.get(`${friend.id}-${dateStr}`) || 0
                        return (
                          <span key={friend.id}>
                            {friend.name.split(' ')[0]}: {count}/{bucketCount}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {isAdmin && (
            <section className="card admin-card">
              <div>
                <h2>Admin controls</h2>
                <p className="muted">Reset all buckets and check-ins. Sessions remain intact.</p>
              </div>
              <button className="danger" onClick={handleAdminReset}>
                Reset data
              </button>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default App
