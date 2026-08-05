import { type ChangeEvent, useEffect, useMemo, useState } from 'react'
import * as holidayJp from '@holiday-jp/holiday_jp'
import './App.css'

type WorkType =
  | 'unset'
  | 'normalWork'
  | 'shiftHoliday'
  | 'substituteWork'
  | 'substituteHoliday'
  | 'siteConvenienceHoliday'
  | 'paidLeave'

type WorkDay = {
  date: string
  workType: WorkType
  pairedDate: string | null
}

type ValidationItem = {
  id: string
  level: 'error' | 'warning'
  message: string
}

const STORAGE_PREFIX = 'furikae-checker:v2:month:'
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

const WORK_TYPE_OPTIONS: Array<{ value: WorkType; label: string }> = [
  { value: 'unset', label: '未設定' },
  { value: 'normalWork', label: '通常出勤' },
  { value: 'shiftHoliday', label: 'シフト休日' },
  { value: 'substituteWork', label: '振替出勤' },
  { value: 'substituteHoliday', label: '振替休日' },
  { value: 'siteConvenienceHoliday', label: '現場都合休' },
  { value: 'paidLeave', label: '有給休暇' },
]

function getCurrentMonthValue(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

function parseDate(dateText: string): Date {
  const [year, month, day] = dateText.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function getJapaneseHolidayMap(monthValue: string): Map<string, string> {
  const [year, month] = monthValue.split('-').map(Number)
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const end = new Date(year, month, 0, 23, 59, 59, 999)

  return new Map(
    holidayJp.between(start, end).map((holiday) => [
      toDateKey(holiday.date),
      holiday.name,
    ]),
  )
}

function isWeekend(dateText: string): boolean {
  const weekday = parseDate(dateText).getDay()
  return weekday === 0 || weekday === 6
}

function formatDate(dateText: string, withWeekday = true): string {
  const date = parseDate(dateText)
  const base = `${date.getMonth() + 1}月${date.getDate()}日`
  return withWeekday ? `${base}（${WEEKDAYS[date.getDay()]}）` : base
}

function createMonthDays(monthValue: string): WorkDay[] {
  const [year, month] = monthValue.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()

  return Array.from({ length: lastDay }, (_, index) => {
    const day = index + 1
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    return {
      date,
      workType: 'unset',
      pairedDate: null,
    }
  })
}

function isWorkType(value: unknown): value is WorkType {
  return WORK_TYPE_OPTIONS.some((option) => option.value === value)
}

function loadMonth(monthValue: string): WorkDay[] {
  const defaults = createMonthDays(monthValue)
  const saved = localStorage.getItem(`${STORAGE_PREFIX}${monthValue}`)

  if (!saved) return defaults

  try {
    const parsed = JSON.parse(saved) as Partial<WorkDay>[]
    const savedMap = new Map(parsed.map((item) => [item.date, item]))
    const validDates = new Set(defaults.map((item) => item.date))

    return defaults.map((defaultDay) => {
      const savedDay = savedMap.get(defaultDay.date)
      const pairedDate =
        typeof savedDay?.pairedDate === 'string' &&
        validDates.has(savedDay.pairedDate)
          ? savedDay.pairedDate
          : null

      return {
        ...defaultDay,
        workType: isWorkType(savedDay?.workType) ? savedDay.workType : 'unset',
        pairedDate,
      }
    })
  } catch {
    return defaults
  }
}

function createRemark(day: WorkDay): string {
  if (day.workType === 'siteConvenienceHoliday') {
    return '現場都合の為お休み'
  }

  if (!day.pairedDate) return ''

  if (day.workType === 'substituteWork') {
    return `${formatDate(day.pairedDate, false)}の振替出勤`
  }

  if (day.workType === 'substituteHoliday') {
    return `${formatDate(day.pairedDate, false)}の振替休日`
  }

  return ''
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function App() {
  const initialMonth = getCurrentMonthValue()
  const [selectedMonth, setSelectedMonth] = useState(initialMonth)
  const [days, setDays] = useState<WorkDay[]>(() => loadMonth(initialMonth))
  const [copyMessage, setCopyMessage] = useState('')

  const holidayMap = useMemo(
    () => getJapaneseHolidayMap(selectedMonth),
    [selectedMonth],
  )

  useEffect(() => {
    localStorage.setItem(
      `${STORAGE_PREFIX}${selectedMonth}`,
      JSON.stringify(days),
    )
  }, [days, selectedMonth])

  const substituteWorkCount = days.filter(
    (day) => day.workType === 'substituteWork',
  ).length

  const substituteHolidayCount = days.filter(
    (day) => day.workType === 'substituteHoliday',
  ).length

  const completedPairCount = days.filter(
    (day) => day.workType === 'substituteWork' && day.pairedDate,
  ).length

  const siteConvenienceHolidayCount = days.filter(
    (day) => day.workType === 'siteConvenienceHoliday',
  ).length

  const validationItems = useMemo<ValidationItem[]>(() => {
    const items: ValidationItem[] = []
    const dayMap = new Map(days.map((day) => [day.date, day]))

    if (substituteWorkCount !== substituteHolidayCount) {
      items.push({
        id: 'count-mismatch',
        level: 'error',
        message:
          `振替出勤は${substituteWorkCount}件、` +
          `振替休日は${substituteHolidayCount}件です。` +
          '件数が一致していません。',
      })
    }

    days.forEach((day) => {
      if (day.workType === 'substituteWork') {
        if (!day.pairedDate) {
          items.push({
            id: `${day.date}-work-unpaired`,
            level: 'error',
            message: `${formatDate(day.date)}の振替休日が未設定です。`,
          })
          return
        }

        const pair = dayMap.get(day.pairedDate)

        if (
          !pair ||
          pair.workType !== 'substituteHoliday' ||
          pair.pairedDate !== day.date
        ) {
          items.push({
            id: `${day.date}-work-invalid-pair`,
            level: 'error',
            message: `${formatDate(day.date)}の対応関係が正しくありません。`,
          })
        }
      }

      if (
        day.workType === 'substituteHoliday' &&
        !day.pairedDate
      ) {
        items.push({
          id: `${day.date}-holiday-unpaired`,
          level: 'error',
          message: `${formatDate(day.date)}の振替出勤日が未設定です。`,
        })
      }
    })

    return items
  }, [days, substituteHolidayCount, substituteWorkCount])

  const handleMonthChange = (monthValue: string) => {
    setSelectedMonth(monthValue)
    setDays(loadMonth(monthValue))
    setCopyMessage('')
  }

  const handleWorkTypeChange = (date: string, workType: WorkType) => {
    setDays((currentDays) => {
      const selectedDay = currentDays.find((day) => day.date === date)
      const oldPairDate = selectedDay?.pairedDate ?? null

      return currentDays.map((day) => {
        if (day.date === date) {
          return { ...day, workType, pairedDate: null }
        }

        if (
          oldPairDate &&
          day.date === oldPairDate &&
          day.pairedDate === date
        ) {
          return { ...day, pairedDate: null }
        }

        return day
      })
    })

    setCopyMessage('')
  }

  const handlePairChange = (date: string, pairedDate: string) => {
    setDays((currentDays) => {
      const source = currentDays.find((day) => day.date === date)
      if (!source) return currentDays

      const oldSourcePair = source.pairedDate

      if (!pairedDate) {
        return currentDays.map((day) => {
          if (day.date === date) return { ...day, pairedDate: null }

          if (
            oldSourcePair &&
            day.date === oldSourcePair &&
            day.pairedDate === date
          ) {
            return { ...day, pairedDate: null }
          }

          return day
        })
      }

      const target = currentDays.find((day) => day.date === pairedDate)
      if (!target) return currentDays

      const oldTargetPair = target.pairedDate

      return currentDays.map((day) => {
        if (day.date === source.date) {
          return { ...day, pairedDate: target.date }
        }

        if (day.date === target.date) {
          return { ...day, pairedDate: source.date }
        }

        if (
          oldSourcePair &&
          day.date === oldSourcePair &&
          day.pairedDate === source.date
        ) {
          return { ...day, pairedDate: null }
        }

        if (
          oldTargetPair &&
          day.date === oldTargetPair &&
          day.pairedDate === target.date
        ) {
          return { ...day, pairedDate: null }
        }

        return day
      })
    })

    setCopyMessage('')
  }

  const getPairCandidates = (source: WorkDay): WorkDay[] => {
    if (source.workType === 'substituteWork') {
      return days.filter(
        (day) =>
          day.workType === 'substituteHoliday' &&
          (!day.pairedDate || day.pairedDate === source.date),
      )
    }

    if (source.workType === 'substituteHoliday') {
      return days.filter(
        (day) =>
          day.workType === 'substituteWork' &&
          (!day.pairedDate || day.pairedDate === source.date),
      )
    }

    return []
  }

  const handleCopyRemark = async (day: WorkDay) => {
    const remark = createRemark(day)
    if (!remark) return

    try {
      await copyToClipboard(remark)
      setCopyMessage(`${formatDate(day.date)}の備考をコピーしました。`)
    } catch {
      setCopyMessage(
        'コピーできませんでした。備考文を選択して手動でコピーしてください。',
      )
    }
  }

  const handleCopyColumn = async () => {
    const columnText = days.map(createRemark).join('\n')

    try {
      await copyToClipboard(columnText)
      setCopyMessage(
        '1日から月末までの備考列をコピーしました。' +
          'スプレッドシートの1日目の備考セルへ貼り付けてください。',
      )
    } catch {
      setCopyMessage(
        'コピーできませんでした。ブラウザの権限を確認してください。',
      )
    }
  }

  const handleReset = () => {
    const shouldReset = window.confirm(
      `${selectedMonth}の入力内容を初期状態へ戻しますか？`,
    )

    if (!shouldReset) return

    localStorage.removeItem(`${STORAGE_PREFIX}${selectedMonth}`)
    setDays(createMonthDays(selectedMonth))
    setCopyMessage('入力内容を初期化しました。')
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">LOCAL WORK REPORT TOOL</p>
          <h1>振替勤務チェッカー</h1>
          <p className="hero-description">
            シフト上の振替出勤と振替休日を対応付け、
            勤務報告書の備考文を作成します。
          </p>
        </div>

        <div className="privacy-badge">
          入力内容はブラウザ内だけに保存
        </div>
      </header>

      <main>
        <section
          className="control-panel"
          aria-labelledby="month-heading"
        >
          <div>
            <h2 id="month-heading">対象月</h2>
            <p className="section-help">
              土日・祝日は参考表示のみです。
              実際の勤務区分はシフトに沿って手動で設定してください。
            </p>
            <p className="holiday-data-note">
              日本の祝日を参考表示：{holidayMap.size}日
            </p>
          </div>

          <div className="control-actions">
            <label className="month-field">
              <span>勤務月</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  handleMonthChange(event.target.value)
                }
              />
            </label>

            <button
              type="button"
              className="secondary-button"
              onClick={handleReset}
            >
              この月を初期化
            </button>
          </div>
        </section>

        <section className="summary-grid" aria-label="勤務区分の集計">
          <article className="summary-card">
            <span>振替出勤</span>
            <strong>{substituteWorkCount}</strong>
            <small>件</small>
          </article>

          <article className="summary-card">
            <span>振替休日</span>
            <strong>{substituteHolidayCount}</strong>
            <small>件</small>
          </article>

          <article className="summary-card">
            <span>ペア完成</span>
            <strong>{completedPairCount}</strong>
            <small>組</small>
          </article>

          <article className="summary-card">
            <span>現場都合休</span>
            <strong>{siteConvenienceHolidayCount}</strong>
            <small>件</small>
          </article>

          <article
            className={`summary-card ${
              validationItems.length > 0 ? 'is-alert' : 'is-ok'
            }`}
          >
            <span>整合性</span>
            <strong>{validationItems.length}</strong>
            <small>
              {validationItems.length === 0 ? '問題なし' : '確認事項'}
            </small>
          </article>
        </section>

        <section className="validation-panel" aria-live="polite">
          <div className="validation-heading">
            <div>
              <h2>つじつまチェック</h2>
              <p className="section-help">
                振替出勤と振替休日だけを1対1で確認します。
              </p>
            </div>

            <span
              className={`status-chip ${
                validationItems.length === 0 ? 'ok' : 'attention'
              }`}
            >
              {validationItems.length === 0
                ? '入力OK'
                : `${validationItems.length}件を確認`}
            </span>
          </div>

          {validationItems.length === 0 ? (
            <p className="validation-success">
              振替出勤と振替休日の対応に問題はありません。
            </p>
          ) : (
            <ul className="validation-list">
              {validationItems.map((item) => (
                <li key={item.id} className={item.level}>
                  <span aria-hidden="true">
                    {item.level === 'error' ? '!' : 'i'}
                  </span>
                  {item.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="report-section"
          aria-labelledby="report-heading"
        >
          <div className="report-heading-row">
            <div>
              <h2 id="report-heading">擬似勤務報告書</h2>
              <p className="section-help">
                「現場都合休」を選ぶと、
                備考に「現場都合の為お休み」を自動生成します。
              </p>
            </div>

            <button
              type="button"
              className="primary-button"
              onClick={handleCopyColumn}
              disabled={days.every((day) => !createRemark(day))}
            >
              備考列をまとめてコピー
            </button>
          </div>

          {copyMessage && (
            <p className="copy-message" role="status">
              {copyMessage}
            </p>
          )}

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">日付</th>
                  <th scope="col">勤務区分</th>
                  <th scope="col">対応日</th>
                  <th scope="col">備考欄へ出力</th>
                  <th scope="col" aria-label="コピー操作" />
                </tr>
              </thead>

              <tbody>
                {days.map((day) => {
                  const remark = createRemark(day)
                  const candidates = getPairCandidates(day)
                  const needsPair =
                    day.workType === 'substituteWork' ||
                    day.workType === 'substituteHoliday'
                  const holidayName = holidayMap.get(day.date)

                  return (
                    <tr
                      key={day.date}
                      className={`${
                        isWeekend(day.date) ? 'weekend-row' : ''
                      } ${holidayName ? 'holiday-row' : ''} ${
                        needsPair && !day.pairedDate ? 'unpaired-row' : ''
                      } ${
                        day.workType === 'siteConvenienceHoliday'
                          ? 'site-holiday-row'
                          : ''
                      }`}
                    >
                      <th scope="row">
                        <span className="date-main">
                          {formatDate(day.date, false)}
                        </span>
                        <span className="weekday">
                          {WEEKDAYS[parseDate(day.date).getDay()]}
                        </span>
                        {holidayName && (
                          <span className="holiday-name">
                            {holidayName}
                          </span>
                        )}
                      </th>

                      <td>
                        <select
                          aria-label={`${formatDate(day.date)}の勤務区分`}
                          value={day.workType}
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            handleWorkTypeChange(
                              day.date,
                              event.target.value as WorkType,
                            )
                          }
                        >
                          {WORK_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td>
                        {needsPair ? (
                          <select
                            aria-label={`${formatDate(day.date)}の対応日`}
                            value={day.pairedDate ?? ''}
                            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                              handlePairChange(day.date, event.target.value)
                            }
                          >
                            <option value="">対応日を選択</option>
                            {candidates.map((candidate) => (
                              <option
                                key={candidate.date}
                                value={candidate.date}
                              >
                                {formatDate(candidate.date)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="empty-cell">—</span>
                        )}
                      </td>

                      <td>
                        {remark ? (
                          <span className="remark-text">{remark}</span>
                        ) : (
                          <span className="empty-cell">—</span>
                        )}
                      </td>

                      <td className="copy-cell">
                        <button
                          type="button"
                          className="row-copy-button"
                          onClick={() => handleCopyRemark(day)}
                          disabled={!remark}
                        >
                          コピー
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="paste-guide">
            <strong>まとめてコピーの使い方</strong>
            <p>
              1日から月末までの空欄を含む1列としてコピーします。
              勤務報告書の「1日」の備考セルを選んで貼り付けてください。
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
