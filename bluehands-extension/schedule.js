// 주간 보고 일정: 매주 월요일 보고, 월요일이 공휴일·대체공휴일 등 쉬는 날이면 다음 근무일에 보고.
// 화면(bluehands.js)과 백그라운드(background.js, 아이콘 '보고' 표시)가 함께 쓴다 - DOM 을 쓰지 않는다.

// 법정 공휴일 · 대체공휴일 (해마다 정부 발표로 바뀔 수 있으니 화면 설정의 '쉬는 날 추가'로 보탤 수 있음)
const KR_HOLIDAYS = {
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절",
  "2026-03-02": "대체공휴일(삼일절)",
  "2026-05-01": "노동절",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "대체공휴일(부처님오신날)",
  "2026-06-03": "전국동시지방선거",
  "2026-06-06": "현충일",
  "2026-08-15": "광복절",
  "2026-08-17": "대체공휴일(광복절)",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절",
  "2026-10-05": "대체공휴일(개천절)",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
  "2027-01-01": "신정",
  "2027-02-06": "설날 연휴",
  "2027-02-07": "설날",
  "2027-02-08": "설날 연휴",
  "2027-02-09": "대체공휴일(설날)",
  "2027-03-01": "삼일절",
  "2027-05-01": "노동절",
  "2027-05-05": "어린이날",
  "2027-05-13": "부처님오신날",
  "2027-06-06": "현충일",
  "2027-08-15": "광복절",
  "2027-08-16": "대체공휴일(광복절)",
  "2027-09-14": "추석 연휴",
  "2027-09-15": "추석",
  "2027-09-16": "추석 연휴",
  "2027-10-03": "개천절",
  "2027-10-04": "대체공휴일(개천절)",
  "2027-10-09": "한글날",
  "2027-10-11": "대체공휴일(한글날)",
  "2027-12-25": "성탄절",
  "2027-12-27": "대체공휴일(성탄절)",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(d) {
  return `${ymd(d)}(${WEEKDAYS[d.getDay()]})`;
}

// '쉬는 날 추가' 글 → { "2026-10-13": "회사 휴무", ... }  (한 줄에 "2026-10-13 회사 휴무" 또는 "2026.10.13")
function parseExtraHolidays(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?\s*(.*)$/);
    if (m) out[`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`] = m[4].trim() || "쉬는 날";
  }
  return out;
}

// 쉬는 날이면 그 이름, 근무일이면 ""
function offDayName(d, extra = {}) {
  const key = ymd(d);
  if (extra[key]) return extra[key];
  if (KR_HOLIDAYS[key]) return KR_HOLIDAYS[key];
  if (d.getDay() === 0 || d.getDay() === 6) return "주말";
  return "";
}

// 그 날짜가 속한 주(월~일)의 보고일: 월요일부터 첫 근무일
function reportDayOfWeek(date, extra = {}) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 그 주 월요일
  const monday = new Date(d);
  for (let i = 0; i < 7 && offDayName(d, extra); i++) d.setDate(d.getDate() + 1);
  return { monday, day: d, moved: d.getTime() !== monday.getTime(), reason: offDayName(monday, extra) };
}

// 오늘 기준: 이번 주 보고일이 지났으면 다음 주 보고일
function reportSchedule(now = new Date(), extra = {}) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeek = reportDayOfWeek(today, extra);
  const next = thisWeek.day < today ? reportDayOfWeek(new Date(today.getTime() + 7 * 86400e3), extra) : thisWeek;
  const prev = reportDayOfWeek(new Date(next.monday.getTime() - 7 * 86400e3), extra);
  return { today, isReportDay: next.day.getTime() === today.getTime(), next, prev };
}

if (typeof module !== "undefined") module.exports = { KR_HOLIDAYS, ymd, parseExtraHolidays, offDayName, reportDayOfWeek, reportSchedule };
