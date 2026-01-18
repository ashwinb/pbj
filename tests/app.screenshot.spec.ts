import { expect, test, type Page } from '@playwright/test'

const fixedTime = new Date('2024-04-15T12:00:00Z').getTime()

async function mockDate(page: Page) {
  await page.addInitScript(({ time }) => {
    const OriginalDate = Date
    class MockDate extends OriginalDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) {
          super(time)
        } else {
          super(...args)
        }
      }

      static now() {
        return time
      }
    }
    // @ts-expect-error overriding for deterministic tests
    window.Date = MockDate
  }, { time: fixedTime })
}

async function mockGoogleScript(page: Page) {
  await page.route('https://accounts.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
  )
}

test('logged out landing page', async ({ page }) => {
  await mockDate(page)
  await mockGoogleScript(page)
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: null, isAdmin: false }),
    })
  )

  await page.goto('/')
  await expect(page.getByText('Daily Habit Hub')).toBeVisible()
  await expect(page).toHaveScreenshot('logged-out.png', { fullPage: true })
})

test('logged in dashboard', async ({ page }) => {
  await mockDate(page)
  await mockGoogleScript(page)
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 1,
          name: 'Sky Taylor',
          email: 'sky@example.com',
          image: null,
        },
        isAdmin: false,
      }),
    })
  )
  await page.route('**/api/buckets', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        buckets: [
          { id: 1, name: 'Strength', sortOrder: 1 },
          { id: 2, name: 'Mobility', sortOrder: 2 },
          { id: 3, name: 'Cardio', sortOrder: 3 },
        ],
      }),
    })
  )
  await page.route('**/api/checkins?month=*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        users: [
          {
            id: 1,
            name: 'Sky Taylor',
            email: 'sky@example.com',
            image: null,
          },
          {
            id: 2,
            name: 'Ari Chen',
            email: 'ari@example.com',
            image: null,
          },
        ],
        entries: [
          { userId: 1, bucketId: 1, date: '2024-04-12', checked: true },
          { userId: 1, bucketId: 2, date: '2024-04-12', checked: true },
          { userId: 2, bucketId: 1, date: '2024-04-12', checked: true },
          { userId: 2, bucketId: 3, date: '2024-04-12', checked: true },
          { userId: 1, bucketId: 1, date: '2024-04-14', checked: true },
          { userId: 1, bucketId: 3, date: '2024-04-14', checked: true },
        ],
      }),
    })
  )

  await page.goto('/')
  await expect(page.getByText("Today's check-in")).toBeVisible()
  await expect(page).toHaveScreenshot('logged-in.png', { fullPage: true })
})
