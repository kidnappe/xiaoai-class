/**
 * 河南师范大学（建设路校区）作息时间与校历
 *
 * 数据整理：2026-11-24
 * 说明：
 *   - 学校对外称“夏季作息时间 / 秋季作息时间”，本文件沿用页面里的 summer / winter 命名；
 *     winter 即通知中的秋季作息，也就是大家常说的冬令时。
 *   - 作息时间为建设路校区；平原湖校区、科技创新港的时间不同，未混入本文件。
 *   - 2026 年切换日期为学校正式通知；2027 年及以后以当年通知为准。
 *
 * 官方来源：
 *   2026 劳动节通知（5月6日起夏季作息）：
 *   https://www.htu.edu.cn/dangzhengban/2026/0427/c3299a381622/page.htm
 *   2026 中秋国庆通知（10月8日起秋季作息）：
 *   https://www.htu.edu.cn/2026/0918/c8955a404774/page.htm
 *   2026-2027 校历：
 *   https://www.htu.edu.cn/2026/0629/c10888a390890/page.htm
 *   2025-2026 校历：
 *   https://www.htu.edu.cn/2025/0627/c10888a350877/page.htm
 *   2026 寒假通知：
 *   https://www.htu.edu.cn/2026/0125/c18269a371625/page.htm
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HTU_SCHEDULE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 建设路校区：每项为 [开始, 结束]，共 10 节
  const summer = [
    ["08:00", "08:45"],
    ["08:55", "09:40"],
    ["10:10", "10:55"],
    ["11:05", "11:50"],
    ["15:00", "15:45"],
    ["15:55", "16:40"],
    ["17:10", "17:55"],
    ["18:05", "18:50"],
    ["20:00", "20:45"],
    ["20:55", "21:40"]
  ];

  const winter = [
    ["08:00", "08:45"],
    ["08:55", "09:40"],
    ["10:10", "10:55"],
    ["11:05", "11:50"],
    ["14:30", "15:15"],
    ["15:25", "16:10"],
    ["16:40", "17:25"],
    ["17:35", "18:20"],
    ["19:30", "20:15"],
    ["20:25", "21:10"]
  ];

  const HTU_SCHOOL = {
    name: "河南师范大学",
    campus: "建设路校区",
    summer,
    winter
  };

  const SCHEDULE_META = {
    summer: {
      label: "夏季作息时间（夏令时）",
      officialName: "夏季作息时间",
      sections: summer,
      adminOffice: [
        { start: "08:00", end: "12:00" },
        { start: "15:00", end: "19:00" }
      ],
      nominalWindow: "05-01 ~ 10-01"
    },
    winter: {
      label: "秋季作息时间（冬令时）",
      officialName: "秋季作息时间",
      sections: winter,
      adminOffice: [
        { start: "08:00", end: "12:00" },
        { start: "14:30", end: "18:30" }
      ],
      nominalWindow: "10-01 ~ 次年 05-01"
    }
  };

  // 2026 年实际切换；2027 年需等当年通知
  const SWITCHES_2026 = {
    summer: {
      effective: "2026-05-06",
      name: "夏季作息时间",
      noticeDate: "2026-04-27",
      note: "劳动节假期结束后首个工作日/上课日执行",
      source: "https://www.htu.edu.cn/dangzhengban/2026/0427/c3299a381622/page.htm"
    },
    winter: {
      effective: "2026-10-08",
      name: "秋季作息时间",
      noticeDate: "2026-09-18",
      note: "国庆节假期结束后首个工作日/上课日执行；即页面里的冬令时",
      source: "https://www.htu.edu.cn/2026/0918/c8955a404774/page.htm"
    }
  };

  // 2026 年两套作息实际覆盖的日期区间
  const SEASON_WINDOWS_2026 = {
    winter: [
      { start: "2026-01-01", end: "2026-05-05" },
      { start: "2026-10-08", end: "2026-12-31" }
    ],
    summer: [
      { start: "2026-05-06", end: "2026-10-07" }
    ]
  };

  const CALENDARS = {
    "2025-2026": {
      label: "2025-2026学年",
      first: {
        label: "2025-2026学年第一学期",
        start: "2025-09-04",
        end: "2026-01-25",
        weeks: 21,
        staffReport: "2025-09-03",
        studentReport: { start: "2025-09-04", end: "2025-09-05" },
        classesStart: "2025-09-08",
        newStudentReport: { start: "2025-09-06", end: "2025-09-07" },
        newStudentClassesStart: "2025-10-09",
        sportsMeet: { start: "2025-10-17", end: "2025-10-19" },
        exam: { start: "2026-01-19", end: "2026-01-25" },
        winterVacation: { start: "2026-01-26", end: "2026-03-03" },
        source: "https://www.htu.edu.cn/2025/0627/c10888a350877/page.htm"
      },
      second: {
        label: "2025-2026学年第二学期",
        start: "2026-03-04",
        end: "2026-07-12",
        weeks: 19,
        staffReport: "2026-03-04",
        studentReport: { start: "2026-03-04", end: "2026-03-05" },
        classesStart: "2026-03-06",
        sportsMeet: { start: "2026-04-15", end: "2026-04-17" },
        exam: { start: "2026-07-06", end: "2026-07-12" },
        source: "https://www.htu.edu.cn/2025/0627/c10888a350877/page.htm"
      },
      third: {
        label: "2025-2026学年第三学期",
        start: "2026-07-13",
        end: "2026-07-26",
        weeks: 2,
        source: "https://www.htu.edu.cn/2025/0627/c10888a350877/page.htm"
      },
      summerVacation: {
        start: "2026-07-27",
        end: "2026-08-27",
        source: "https://www.htu.edu.cn/2025/0627/c10888a350877/page.htm"
      }
    },
    "2026-2027": {
      label: "2026-2027学年",
      first: {
        label: "2026-2027学年第一学期",
        start: "2026-09-07",
        end: "2027-01-17",
        weeks: 19,
        staffReport: "2026-09-02",
        studentReport: { start: "2026-09-03", end: "2026-09-04" },
        classesStart: "2026-09-07",
        newStudentReport: { start: "2026-09-05", end: "2026-09-06" },
        // 校历原文为“7-30日军训和入学教育”，按上下文应为 9 月 7-30 日
        newStudentMilitary: { start: "2026-09-07", end: "2026-09-30" },
        newStudentClassesStart: "2026-10-08",
        exam: { start: "2027-01-11", end: "2027-01-17" },
        winterVacation: { start: "2027-01-18", end: "2027-02-21" },
        source: "https://www.htu.edu.cn/2026/0629/c10888a390890/page.htm"
      },
      second: {
        label: "2026-2027学年第二学期",
        start: "2027-02-22",
        end: "2027-07-04",
        weeks: 19,
        staffReport: "2027-02-21",
        studentReport: { start: "2027-02-21", end: "2027-02-21" },
        classesStart: "2027-02-22",
        sportsMeet: { start: "2027-04-14", end: "2027-04-16" },
        exam: { start: "2027-06-28", end: "2027-07-04" },
        source: "https://www.htu.edu.cn/2026/0629/c10888a390890/page.htm"
      },
      third: {
        label: "2026-2027学年第三学期",
        start: "2027-07-05",
        end: "2027-07-18",
        weeks: 2,
        source: "https://www.htu.edu.cn/2026/0629/c10888a390890/page.htm"
      },
      summerVacation: {
        start: "2027-07-19",
        end: "2027-08-29",
        source: "https://www.htu.edu.cn/2026/0629/c10888a390890/page.htm"
      }
    }
  };

  // 2026 年节假日：有正式通知的写放假区间与调休，其余只记校历标注日期
  const HOLIDAYS = {
    2026: [
      { name: "元旦", date: "2026-01-01", note: "校历标注节日日期，具体调休以学校通知为准" },
      { name: "清明节", date: "2026-04-05", note: "校历标注节日日期，具体调休以学校通知为准" },
      {
        name: "劳动节",
        date: "2026-05-01",
        span: { start: "2026-05-01", end: "2026-05-05" },
        makeup: ["2026-05-09"],
        note: "5月6日起执行夏季作息时间",
        source: "https://www.htu.edu.cn/dangzhengban/2026/0427/c3299a381622/page.htm"
      },
      { name: "端午节", date: "2026-06-19", note: "校历标注节日日期，具体调休以学校通知为准" },
      {
        name: "中秋节",
        date: "2026-09-25",
        span: { start: "2026-09-25", end: "2026-09-27" },
        source: "https://www.htu.edu.cn/2026/0918/c8955a404774/page.htm"
      },
      {
        name: "国庆节",
        date: "2026-10-01",
        span: { start: "2026-10-01", end: "2026-10-07" },
        makeup: ["2026-09-20", "2026-10-10"],
        note: "10月8日起执行秋季作息时间",
        source: "https://www.htu.edu.cn/2026/0918/c8955a404774/page.htm"
      }
    ],
    2027: [
      { name: "元旦", date: "2027-01-01", note: "校历标注节日日期，具体调休以学校通知为准" },
      { name: "清明节", date: "2027-04-05", note: "校历标注节日日期，具体调休以学校通知为准" },
      { name: "劳动节", date: "2027-05-01", note: "校历标注节日日期，具体调休以学校通知为准" },
      { name: "端午节", date: "2027-06-09", note: "校历标注节日日期，具体调休以学校通知为准" }
    ]
  };

  function isoDate(value) {
    if (value instanceof Date) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, "0");
      const d = String(value.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + d;
    }
    const m = String(value == null ? "" : value).match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : "";
  }

  function inRange(date, range) {
    return !!range && date >= range.start && date <= range.end;
  }

  /**
   * 2026 年按学校实际通知切换；其他年份按校历标注的 5-9 月夏季、10-4 月秋季估算，
   * 实际仍以当年通知为准。
   */
  function seasonOn(value) {
    const d = isoDate(value);
    if (!d) return null;
    if (d.slice(0, 4) === "2026") {
      if (d < "2026-05-06") return "winter";
      if (d < "2026-10-08") return "summer";
      return "winter";
    }
    const month = parseInt(d.slice(5, 7), 10);
    return month >= 5 && month <= 9 ? "summer" : "winter";
  }

  function scheduleOn(value) {
    const season = seasonOn(value);
    return season ? SCHEDULE_META[season] : null;
  }

  /**
   * 返回某天所属的学期或假期（优先判断寒暑假和第三学期）。
   * 找不到时返回 null（例如暑假结束到新学期报到之间的空档）。
   */
  function calendarOn(value) {
    const d = isoDate(value);
    if (!d) return null;
    for (const key of Object.keys(CALENDARS)) {
      const c = CALENDARS[key];
      if (c.first && c.first.winterVacation && inRange(d, c.first.winterVacation)) {
        return { type: "vacation", name: "寒假", start: c.first.winterVacation.start, end: c.first.winterVacation.end, academicYear: key };
      }
      if (c.third && inRange(d, c.third)) {
        return { type: "term", name: c.third.label, start: c.third.start, end: c.third.end, weeks: c.third.weeks, academicYear: key };
      }
      if (c.summerVacation && inRange(d, c.summerVacation)) {
        return { type: "vacation", name: "暑假", start: c.summerVacation.start, end: c.summerVacation.end, academicYear: key };
      }
      if (c.first && inRange(d, c.first)) {
        return { type: "term", name: c.first.label, start: c.first.start, end: c.first.end, weeks: c.first.weeks, classesStart: c.first.classesStart, academicYear: key };
      }
      if (c.second && inRange(d, c.second)) {
        return { type: "term", name: c.second.label, start: c.second.start, end: c.second.end, weeks: c.second.weeks, classesStart: c.second.classesStart, academicYear: key };
      }
    }
    return null;
  }

  return {
    HTU_SCHOOL,
    SCHEDULE_META,
    SWITCHES_2026,
    SEASON_WINDOWS_2026,
    CALENDARS,
    HOLIDAYS,
    seasonOn,
    scheduleOn,
    calendarOn
  };
});
