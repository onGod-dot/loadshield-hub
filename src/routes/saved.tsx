import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Activity, MapPin, Clock, Trash2, Search, ChevronRight,
  Globe, Shield, ArrowRight, WifiOff, AlertTriangle, BookOpen,
  History, ChevronDown, FileText, DollarSign, GraduationCap,
  User, Calendar, Download, Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { SectionCard, StatCard } from "@/components/ui-bits";
import {
  fetchPortalSessions, clearPortalSessions, fetchPortalSnapshots,
  type PortalSession, type PortalEvent, type GatewaySnapshot, type GatewayChange,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  upsertPortalSnapshot, insertPortalChange, loadPortalSnapshots, loadPortalChanges,
  type PortalSnapshotRow, type PortalChangeRow,
} from "@/lib/supabase";

export const Route = createFileRoute("/saved")({
  head: () => ({
    meta: [
      { title: "Portal Sessions — TTU-LoadShield" },
      { name: "description", content: "Live tracking of students accessing the TTU portal through LoadShield." },
    ],
  }),
  component: SavedPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}
function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function statusColor(status: number): string {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-[color:var(--warning)]";
  if (status >= 300) return "text-primary";
  return "text-[color:var(--success)]";
}
function pageName(path: string): string {
  if (!path || path === "/") return "Home";
  const clean = path.replace(/^\/+|\/+$/g, "").split("?")[0];
  return clean.split("/").pop()!.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Home";
}
function truncate(text: string, max = 280): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function ContentIcon({ label, className }: { label: string; className?: string }) {
  const l = label.toLowerCase();
  if (l.includes("result") || l.includes("grade")) return <GraduationCap className={className} />;
  if (l.includes("fee") || l.includes("payment") || l.includes("finance")) return <DollarSign className={className} />;
  if (l.includes("transcript")) return <FileText className={className} />;
  if (l.includes("profile") || l.includes("biodata") || l.includes("status")) return <User className={className} />;
  if (l.includes("course") || l.includes("registration") || l.includes("outline") || l.includes("resit")) return <BookOpen className={className} />;
  if (l.includes("schedule") || l.includes("timetable") || l.includes("lecturing") || l.includes("exams timetable")) return <Calendar className={className} />;
  if (l.includes("dashboard") || l.includes("home")) return <Activity className={className} />;
  if (l.includes("assessment")) return <GraduationCap className={className} />;
  if (l.includes("liaison") || l.includes("attachment") || l.includes("assumption")) return <Briefcase className={className} />;
  if (l.includes("library")) return <BookOpen className={className} />;
  if (l.includes("graduation")) return <GraduationCap className={className} />;
  if (l.includes("policy") || l.includes("policies")) return <Shield className={className} />;
  return <FileText className={className} />;
}

function statusBadge(val: string) {
  const yes = /yes/i.test(val);
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${yes ? "bg-[color:var(--success)]/10 text-[color:var(--success)]" : "bg-destructive/10 text-destructive"}`}>
      {val}
    </span>
  );
}

function gpaColor(gpa: number): string {
  if (gpa >= 3.5) return "text-[color:var(--success)]";
  if (gpa >= 3.0) return "text-primary";
  if (gpa >= 2.5) return "text-[color:var(--warning)]";
  return "text-destructive";
}
function gradeColor(grade: string): string {
  if (grade === "A+" || grade === "A") return "text-[color:var(--success)] font-bold";
  if (grade === "B+" || grade === "B") return "text-primary font-semibold";
  if (grade === "C+" || grade === "C") return "text-foreground";
  if (grade === "D") return "text-[color:var(--warning)]";
  if (grade === "F") return "text-destructive font-bold";
  return "text-muted-foreground";
}

// ── Parsers ───────────────────────────────────────────────────────────────────

interface StudentInfo { indexNumber: string; name: string; gender: string; programme: string; certificateType: string; session: string; gradYear: string; dob: string; }
interface CourseRow { code: string; name: string; credits: number; grade: string; score: number | null; gradePoints: number; }
interface Semester { year: string; level: string; semester: string; courses: CourseRow[]; gpa: number | null; cgpa: number | null; totalCredits: number | null; totalPoints: number | null; classification: string; }
interface ParsedResults { student: Partial<StudentInfo>; semesters: Semester[]; }
interface ParsedDashboard { name: string; indexNumber: string; level: string; programme: string; status: { reg: string; ass: string; bio: string; phy: string; xray: string }; }
interface FeeItem { description: string; amount: string; }
interface FeeStatementRow { date: string; level: string; type: string; fees: string; bill: string; payment: string; balance: string; }
interface ParsedFees {
  name: string; indexNumber: string; programme: string;
  openingBalance: string; totalFees: string; totalBilled: string;
  totalPaid: string; outstandingBalance: string;
  resitCount: string; totalResitPaid: string;
  items: FeeItem[];
  statementRows: FeeStatementRow[];
}
interface ParsedBiodata { name: string; indexNumber: string; dob: string; gender: string; nationality: string; email: string; phone: string; programme: string; level: string; fields: Array<{ label: string; value: string }>; }
interface TimetableEntry { day: string; time: string; course: string; code: string; credits: string; lecturer: string; venue: string; }
interface ParsedTimetable { entries: TimetableEntry[]; title: string; isExam: boolean; }
interface ParsedHome { name: string; indexNumber: string; level: string; programme: string; status: { reg: string; ass: string; bio: string; phy: string; xray: string }; quickLinks: Array<{ title: string; desc: string }>; }
interface ParsedCourseReg { name: string; indexNumber: string; level: string; semester: string; courses: Array<{ code: string; name: string; credits: number; lecturer: string }>; totalCredits: number; }
interface ParsedAssessment { name: string; indexNumber: string; lecturers: Array<{ name: string; course: string; code: string; status: string }>; noLecturers?: boolean; }
interface ParsedLiaison { name: string; indexNumber: string; company: string; supervisor: string; startDate: string; endDate: string; items: Array<{ label: string; value: string }>; }
interface ParsedGenericPortal { title: string; name: string; indexNumber: string; items: Array<{ label: string; value: string }>; rawText: string; }

function parseResultsText(text: string): ParsedResults | null {
  if (!text || text.length < 50) return null;
  const student: Partial<StudentInfo> = {};
  const semesters: Semester[] = [];
  student.indexNumber = text.match(/INDEX NUMBER\s+([\w]+)/i)?.[1] ?? "";
  student.name = text.match(/NAME\s+([\w\s,]+?)(?=\s+GENDER)/i)?.[1]?.trim() ?? "";
  student.gender = text.match(/GENDER\s+(MALE|FEMALE)/i)?.[1] ?? "";
  student.programme = text.match(/PROGRAMME\s+([\w\s&]+?)(?=\s+SESSION)/i)?.[1]?.trim() ?? "";
  student.certificateType = text.match(/TYPE OF CERTIFICATE\s+([\w\s]+?)(?=\s+PROGRAMME)/i)?.[1]?.trim() ?? "";
  student.session = text.match(/SESSION\s+([\w\s]+?)(?=\s+GRAD)/i)?.[1]?.trim() ?? "";
  student.gradYear = text.match(/GRAD YEAR\s+([\d/]+)/i)?.[1] ?? "";
  student.dob = text.match(/DATE OF BIRTH\s+([\d-]+)/i)?.[1] ?? "";
  const semBlocks = text.split(/(?=YEAR\s*:\s*\d{4}\/\d{4})/);
  for (const block of semBlocks) {
    const yearMatch = block.match(/YEAR\s*:\s*(\d{4}\/\d{4})\s*,\s*LEVEL\s*:\s*(\w+)/i);
    const semMatch = block.match(/SEMESTER\s*:\s*(\d+)/i);
    if (!yearMatch) continue;
    const courses: CourseRow[] = [];
    const courseRe = /([A-Z]{2,6}\d{3}(?:\s*\*)?)\s+([\w\s&()\/,+\-]+?)\s+(\d+)\s+(?:No mark found\s*-->\s*)?(A\+?|B\+?|C\+?|D\+?|F|P|I)\s+([\d.]+)\s+([\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = courseRe.exec(block)) !== null) {
      const code = m[1].replace(/\s*\*\s*/g, "").trim();
      if (!courses.find((c) => c.code === code && c.grade === m![4])) {
        courses.push({ code, name: m![2].trim(), credits: parseInt(m![3]), grade: m![4], score: parseFloat(m![5]), gradePoints: parseFloat(m![6]) });
      }
    }
    const gpa = block.match(/(?<![CG])GPA\s+([\d.]+)/i)?.[1];
    const cgpa = block.match(/CGPA\s+([\d.]+)/i)?.[1];
    const classification = block.match(/(First class|Second upper|Second lower|Third class|Pass)/i)?.[1] ?? "";
    semesters.push({ year: yearMatch[1], level: yearMatch[2], semester: semMatch?.[1] ?? "?", courses, gpa: gpa ? parseFloat(gpa) : null, cgpa: cgpa ? parseFloat(cgpa) : null, totalCredits: null, totalPoints: null, classification });
  }
  return { student, semesters };
}

function parseDashboard(text: string): ParsedDashboard | null {
  const clean = text.replace(/&#x[0-9A-Fa-f]+;/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const name = clean.match(/person\s+([\w\s,]+?)\s+(\d{10})/i)?.[1]?.trim() ?? "";
  const indexNumber = clean.match(/person\s+[\w\s,]+?\s+(\d{10})/i)?.[1] ?? "";
  const level = clean.match(/school\s+Level\s+([\w\s]+?)(?=\s+HND|\s+BSc|\s+BTech)/i)?.[1]?.trim() ?? "";
  const programme = clean.match(/HND\s+([\w\s&]+?)(?=\s+analytics)/i)?.[1]?.trim() ?? clean.match(/BSc\s+([\w\s&]+?)(?=\s+analytics)/i)?.[1]?.trim() ?? clean.match(/BTech\s+([\w\s&]+?)(?=\s+analytics)/i)?.[1]?.trim() ?? "";

  // The clearance line looks like:
  // "In school Reg   Ass   Bio   Phy   Xray --> YES   Yes   Yes   Yes   Yes"
  // We find the "--> " separator then grab the 5 values after it.
  let statuses: string[] = [];
  const clearanceBlock = clean.match(/Reg\s+Ass\s+Bio\s+Phy\s+Xray\s*-->\s*([\w\s]+?)(?=manage_search|$)/i)?.[1] ?? "";
  if (clearanceBlock) {
    statuses = clearanceBlock.trim().split(/\s+/).slice(0, 5);
  } else {
    // fallback: find "-->" then take next 5 words
    const arrowMatch = clean.match(/-->\s*((?:YES|Yes|No)\s+(?:YES|Yes|No)\s+(?:YES|Yes|No)\s+(?:YES|Yes|No)\s+(?:YES|Yes|No))/i);
    if (arrowMatch) {
      statuses = arrowMatch[1].trim().split(/\s+/).slice(0, 5);
    }
  }

  return { name, indexNumber, level, programme, status: { reg: statuses[0] ?? "—", ass: statuses[1] ?? "—", bio: statuses[2] ?? "—", phy: statuses[3] ?? "—", xray: statuses[4] ?? "—" } };
}

function parseFeesText(text: string): ParsedFees | null {
  if (!text || text.length < 30) return null;
  const clean = text.replace(/&#x[0-9A-Fa-f]+;/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

  // Student identity — TTU portal doesn't show name/index on the fees page
  // but we can still grab them from the nav sidebar pattern
  const name = clean.match(/person\s+([\w\s,]+?)\s+(\d{10})/i)?.[1]?.trim() ?? "";
  const indexNumber = clean.match(/\b(\d{10})\b/)?.[1] ?? "";
  const programme = clean.match(/HND\s+([\w\s&]+?)(?=\s+analytics|\s+Opening|\s+Total)/i)?.[1]?.trim() ??
    clean.match(/BSc\s+([\w\s&]+?)(?=\s+analytics|\s+Opening|\s+Total)/i)?.[1]?.trim() ?? "";

  // Summary figures — TTU format: "Opening b/c: GHcXXX  Total Fees: GHcXXX ..."
  const ghc = (label: string) =>
    clean.match(new RegExp(`${label}[:\\s]+GHc?\\s*([\\d,. ]+)`, "i"))?.[1]?.trim() ?? "";

  const openingBalance   = ghc("Opening b\\/c");
  const totalFees        = ghc("Total Fees");
  const totalBilled      = ghc("Total bill");
  const totalPaid        = clean.match(/Paid\s*:\s*GHc\s*([\d,.]+)/i)?.[1]?.trim() ?? ghc("Paid");
  const outstandingBalance = ghc("Outstanding b\\/c");
  const resitCount       = clean.match(/Resit\s*\/\s*Supplementary[:\s]+([\d]+)/i)?.[1] ?? "";
  const totalResitPaid   = clean.match(/Total Resit Paid[:\s]+([\d,.]+)/i)?.[1] ?? "";

  // Miscellaneous charge items (e.g. "Graduation Fee 88.0", "Resit 50.0")
  const items: FeeItem[] = [];
  const miscRe = /(\d{2}-\d{2}-\d{4})\s*-\s*(\w+)\s*-\s*([\d.]+)\s*-\s*([\w\s]+)/g;
  let mm: RegExpExecArray | null;
  while ((mm = miscRe.exec(clean)) !== null) {
    items.push({ description: `${mm[4].trim()} (${mm[2]} · ${mm[1]})`, amount: `GHc ${mm[3]}` });
  }

  // Statement of account rows: DATE LEVEL TYPE FEES --> BILL PAYMENT BALANCE
  const statementRows: FeeStatementRow[] = [];
  // Pattern after "Statement of Account ... -->"
  const stmtBlock = clean.match(/Statement of Account[\s\S]*?(?=©|$)/i)?.[0] ?? clean;
  const rowRe = /(\d{2}-\d{2}-\d{4})\s+(\w+)\s+([\w\s]+?)\s+([\d,]+)\s*-->\s*-->\s*([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(stmtBlock)) !== null) {
    statementRows.push({
      date: rm[1], level: rm[2], type: rm[3].trim(),
      fees: rm[4], bill: rm[5], payment: rm[6], balance: rm[7],
    });
  }

  return { name, indexNumber, programme, openingBalance, totalFees, totalBilled, totalPaid, outstandingBalance, resitCount, totalResitPaid, items, statementRows };
}

function parseBiodataText(text: string): ParsedBiodata | null {
  if (!text || text.length < 30) return null;
  const clean = text.replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const extract = (label: string) => clean.match(new RegExp(`${label}[:\\s]+([\\w\\s@.,+-]+?)(?=\\s{2,}|[A-Z]{3,}\\s*:|$)`, "i"))?.[1]?.trim() ?? "";
  const fields: Array<{ label: string; value: string }> = [];
  const fieldRe = /([A-Z][A-Z\s]{3,20})[:\s]+([^\n]{2,60})(?=\s{2,}|[A-Z]{3,}\s*:|$)/g;
  let m;
  while ((m = fieldRe.exec(clean)) !== null) {
    const lbl = m[1].trim(); const val = m[2].trim();
    if (val.length > 1 && !/^(undefined|null)$/i.test(val)) fields.push({ label: lbl, value: val });
  }
  return { name: extract("(?:FULL\\s+)?NAME"), indexNumber: clean.match(/\b(\d{10})\b/)?.[1] ?? "", dob: extract("(?:DATE\\s+OF\\s+)?BIRTH"), gender: extract("GENDER"), nationality: extract("NATIONALITY"), email: extract("EMAIL"), phone: extract("(?:PHONE|MOBILE|CONTACT)"), programme: extract("PROGRAMME"), level: extract("LEVEL"), fields: fields.slice(0, 12) };
}

function parseTimetableText(text: string): ParsedTimetable | null {
  if (!text || text.length < 30) return null;
  const clean = text.replace(/&#x[0-9A-Fa-f]+;/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const isExam = /timetableExams/i.test(text) || /Exams Timetable/i.test(text);
  const title = isExam ? "Exams Timetable" : "Lecturing Timetable";
  const entries: TimetableEntry[] = [];

  if (isExam) {
    // ── Exams Timetable ──────────────────────────────────────────────────────
    // Format: COURSE_NAME (CODE) DAY, Nth MONTH TIME VENUE_SHORT - VENUE_FULL
    const examRe = /([A-Z][A-Z0-9 &/\-]+?)\s+\(([A-Z]{2,6}\d{3})\)\s+(\w+,\s+\w+\s+\w+)\s+(\d+:\d+\s*(?:am|pm)\s+to\s+\d+:\d+\s*(?:am|pm))\s+([A-Z0-9 ]+?-\s*[A-Z ]+\d+)/gi;
    let m: RegExpExecArray | null;
    while ((m = examRe.exec(clean)) !== null) {
      entries.push({
        course:   m[1].trim(),
        code:     m[2],
        day:      m[3].trim(),
        time:     m[4].trim(),
        credits:  "",
        lecturer: "",
        venue:    m[5].trim(),
      });
    }
  } else {
    // ── Lecturing Timetable ──────────────────────────────────────────────────
    // Format: COURSE_NAME CODE - N credits LECTURER DAY - TIME // Group X VENUE
    // Use code positions as anchors
    const codePositions: Array<[number, string]> = [];
    const codeRe = /\b([A-Z]{2,6}\d{3})\b/g;
    let cm: RegExpExecArray | null;
    while ((cm = codeRe.exec(clean)) !== null) codePositions.push([cm.index, cm[1]]);

    const DAYS = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|N/A|anyDay";

    function extractCourseName(pre: string): string {
      // After last room code (e.g. SF6, LH1)
      const roomMatch = [...pre.matchAll(/\b[A-Z]+\d+\b/g)];
      if (roomMatch.length > 0) {
        const last = roomMatch[roomMatch.length - 1];
        const after = pre.slice(last.index! + last[0].length).trim();
        if (after) return after.replace(/^[\s\-/\\]+/, "").trim();
      }
      // After N/A N/A block (entries following a no-schedule course)
      const naMatch = pre.match(/N\/A\s+N\/A\s+(.*)/i);
      if (naMatch) return naMatch[1].trim();
      return pre.replace(/^[\s\-/\\]+/, "").trim();
    }

    for (let i = 0; i < codePositions.length; i++) {
      const [pos, code] = codePositions[i];
      const end = i + 1 < codePositions.length ? codePositions[i + 1][0] : clean.length;
      const block = clean.slice(pos + code.length, end).trim();
      const preStart = i > 0 ? codePositions[i - 1][0] + codePositions[i - 1][1].length : 0;
      const pre = clean.slice(preStart, pos);
      const course = extractCourseName(pre);

      const credM   = block.match(/-\s*(\d+)\s+credits/);
      const dayPat  = new RegExp(`(${DAYS})\\s*-?\\s*([\\d:]+\\s+to\\s+[\\d:]+|N\\/A)`, "i");
      const lecPat  = new RegExp(`credits\\s+(.+?)\\s+(?:${DAYS})`, "i");
      const dayM    = block.match(dayPat);
      const lecM    = block.match(lecPat);

      // Venue: text after time, strip group annotation, up to last room code or SELECTED
      let venue = "N/A";
      if (dayM) {
        const afterTime = block.slice(block.indexOf(dayM[0]) + dayM[0].length).trim();
        const stripped  = afterTime.replace(/^\/\/\s*Group\s*\w+\s*/i, "").trim();
        const venM      = stripped.match(/^(.*?(?:[A-Z]+\d+|SELECTED))/i);
        const raw       = venM ? venM[1].trim() : stripped;
        // If venue looks like a course name (all caps words with no room code), set N/A
        venue = /[A-Z]+\d+|SELECTED/i.test(raw) ? raw : "N/A";
      }

      entries.push({
        course:   course || "—",
        code,
        credits:  credM?.[1] ?? "",
        lecturer: lecM?.[1]?.trim() ?? "",
        day:      dayM?.[1] ?? "N/A",
        time:     dayM?.[2] ?? "N/A",
        venue,
      });
    }
  }

  return { title, entries, isExam };
}

// ── Additional parsers ────────────────────────────────────────────────────────

// Portal home and dashboard share the same HTML structure
function parseHomePage(text: string): ParsedHome | null {
  const d = parseDashboard(text);
  if (!d) return null;
  const clean = text.replace(/&#x[0-9A-Fa-f]+;/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  // Extract quick link pairs: "icon_name Title Description"
  const QUICK_LINKS = [
    { title: "Check Results", desc: "Access your exam scores and academic grade reports" },
    { title: "Check Status", desc: "Verify your current profile and registration status" },
    { title: "Lecturing Timetable", desc: "View your weekly lecture schedule" },
    { title: "Exams Timetable", desc: "Check your examination dates and venue locations" },
    { title: "Registration Steps", desc: "Read this before registering your courses" },
    { title: "Register Courses", desc: "Enroll in your courses for the current semester" },
    { title: "Register Resit", desc: "Register to write failed courses" },
    { title: "Assess Lecturers", desc: "Provide feedback on teaching and course delivery" },
    { title: "Fee Payments", desc: "View your financial statement and track payments" },
    { title: "Course Outlines", desc: "Download syllabus and outlines for registered courses" },
    { title: "E-Library", desc: "Access digital books, journals, and research materials" },
    { title: "Attachment Letter", desc: "Generate and print your industrial attachment letters" },
    { title: "Assumption Form", desc: "Submit your assumption of duty forms for attachment" },
    { title: "Graduation", desc: "Apply for graduation and check clearance status" },
  ].filter(lk => clean.toLowerCase().includes(lk.title.toLowerCase()));
  return { ...d, quickLinks: QUICK_LINKS };
}

function parseCourseRegistration(text: string): ParsedCourseReg | null {
  if (!text || text.length < 30) return null;
  const clean = text.replace(/&#x[0-9A-Fa-f]+;/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const name = clean.match(/person\s+([\w\s,]+?)\s+(\d{10})/i)?.[1]?.trim() ?? clean.match(/NAME[:\s]+([\w\s,]+?)(?=\s+INDEX|\s+\d{10})/i)?.[1]?.trim() ?? "";
  const indexNumber = clean.match(/\b(\d{10})\b/)?.[1] ?? "";
  const level = clean.match(/Level\s+([\w]+)/i)?.[1] ?? "";
  const semester = clean.match(/Semester\s+([\w]+)/i)?.[1] ?? "";
  const courses: ParsedCourseReg["courses"] = [];
  // Match: CODE COURSE_NAME CREDITS [LECTURER]
  const courseRe = /([A-Z]{2,6}\d{3})\s+([\w\s&()\/,+\-]{5,60}?)\s+(\d)\s+([\w\s.]+?)(?=[A-Z]{2,6}\d{3}|$)/g;
  let m: RegExpExecArray | null;
  while ((m = courseRe.exec(clean)) !== null) {
    courses.push({ code: m[1].trim(), name: m[2].trim(), credits: parseInt(m[3]), lecturer: m[4].trim().slice(0, 40) });
  }
  const totalCredits = courses.reduce((s, c) => s + c.credits, 0);
  return { name, indexNumber, level, semester, courses, totalCredits };
}

function parseAssessment(text: string): ParsedAssessment | null {
  if (!text || text.length < 30) return null;
  const clean = text.replace(/&#x[0-9A-Fa-f]+;/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const name = clean.match(/person\s+([\w\s,]+?)\s+(\d{10})/i)?.[1]?.trim() ?? "";
  const indexNumber = clean.match(/\b(\d{10})\b/)?.[1] ?? "";
  const lecturers: ParsedAssessment["lecturers"] = [];
  const noLecturers = /no lecturers to assess/i.test(clean);
  if (!noLecturers) {
    const re = /([A-Z]{2,6}\d{3})\s+([\w\s&()\/,+\-]{4,50}?)\s+((?:Dr|Mr|Mrs|Ms|Prof)\.?\s+[\w\s.]{3,30}?)\s+(Assessed|Pending|Not\s+Assessed)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      lecturers.push({ code: m[1], course: m[2].trim(), name: m[3].trim(), status: m[4].trim() });
    }
    if (lecturers.length === 0) {
      const re2 = /([A-Z]{2,6}\d{3})\s+([\w\s&()\/,+\-]{4,50}?)\s+((?:Dr|Mr|Mrs|Ms|Prof)\.?\s+[\w\s.]{3,25})/gi;
      let m2: RegExpExecArray | null;
      while ((m2 = re2.exec(clean)) !== null) {
        lecturers.push({ code: m2[1], course: m2[2].trim(), name: m2[3].trim(), status: "Pending" });
      }
    }
  }
  return { name, indexNumber, lecturers, noLecturers };
}

function parseLiaison(text: string): ParsedLiaison | null {
  if (!text || text.length < 30) return null;
  const clean = text.replace(/&#x[0-9A-Fa-f]+;/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const name = clean.match(/person\s+([\w\s,]+?)\s+(\d{10})/i)?.[1]?.trim() ?? clean.match(/NAME[:\s]+([\w\s,]+?)(?=\s+INDEX|\s+\d{10})/i)?.[1]?.trim() ?? "";
  const indexNumber = clean.match(/\b(\d{10})\b/)?.[1] ?? "";
  const company = clean.match(/(?:COMPANY|ORGANIZATION|ORGANISATION|EMPLOYER)[:\s]+([\w\s&.,()-]{3,60}?)(?=\s{2,}|[A-Z]{3,}:|$)/i)?.[1]?.trim() ?? "";
  const supervisor = clean.match(/(?:SUPERVISOR|MENTOR)[:\s]+([\w\s.,]{3,40}?)(?=\s{2,}|[A-Z]{3,}:|$)/i)?.[1]?.trim() ?? "";
  const startDate = clean.match(/(?:START|COMMENCEMENT)[:\s]+([\d\-\/]+)/i)?.[1] ?? "";
  const endDate = clean.match(/(?:END|COMPLETION)[:\s]+([\d\-\/]+)/i)?.[1] ?? "";
  const items: Array<{ label: string; value: string }> = [];
  const fieldRe = /([A-Z][A-Z\s]{3,24})[:\s]+([\w\s@.,+\-()]{2,60})(?=\s{2,}|[A-Z]{3,}\s*:|$)/g;
  let m;
  while ((m = fieldRe.exec(clean)) !== null) {
    const lbl = m[1].trim(); const val = m[2].trim();
    if (val.length > 1 && !items.find(i => i.label === lbl)) items.push({ label: lbl, value: val });
  }
  return { name, indexNumber, company, supervisor, startDate, endDate, items: items.slice(0, 10) };
}

function parseGenericPortalPage(text: string, contentType: string): ParsedGenericPortal {
  const clean = text.replace(/&#x[0-9A-Fa-f]+;/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const name = clean.match(/person\s+([\w\s,]+?)\s+(\d{10})/i)?.[1]?.trim() ?? "";
  const indexNumber = clean.match(/\b(\d{10})\b/)?.[1] ?? "";
  const items: Array<{ label: string; value: string }> = [];
  const fieldRe = /([A-Z][A-Z\s]{3,24})[:\s]+([\w\s@.,+\-()]{2,80})(?=\s{2,}|[A-Z]{3,}\s*:|$)/g;
  let m;
  while ((m = fieldRe.exec(clean)) !== null) {
    const lbl = m[1].trim(); const val = m[2].trim();
    if (val.length > 1 && !items.find(i => i.label === lbl)) items.push({ label: lbl, value: val });
  }
  return { title: contentType, name, indexNumber, items: items.slice(0, 12), rawText: text };
}

// ── Shared PDF styles ────────────────────────────────────────────────────────
const PDF_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;color:#1e293b;background:#fff;padding:26px 30px}.doc-header{border-bottom:2px solid #2563eb;padding-bottom:11px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-end}.doc-title{font-size:17px;font-weight:800;color:#1e293b}.doc-sub{font-size:10px;color:#64748b;margin-top:2px}.doc-meta{text-align:right;font-size:9px;color:#94a3b8}.student-box{display:flex;justify-content:space-between;align-items:flex-start;background:#f0f9ff;border:1px solid #bfdbfe;border-radius:7px;padding:11px 13px;margin-bottom:13px;gap:12px}.sname{font-size:14px;font-weight:700;color:#1e293b}.sdetail{font-size:9px;color:#64748b;margin-top:2px}.cgpa{font-size:22px;font-weight:900;color:#2563eb;text-align:right;line-height:1}.cgpa small{font-size:9px;font-weight:400;color:#64748b;margin-left:3px}.cls{font-size:9px;color:#64748b;text-align:right;text-transform:capitalize}.sec-h{background:#f1f5f9;padding:6px 11px;font-size:10px;font-weight:700;color:#334155;display:flex;align-items:center;justify-content:space-between;border-radius:4px 4px 0 0;border:1px solid #e2e8f0;border-bottom:none;margin-top:12px}.gpa-pill{background:#dbeafe;color:#1d4ed8;border-radius:20px;padding:1px 7px;font-size:9px;font-weight:700}table{width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:0 0 4px 4px}th{background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:5px 8px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:700}td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:10px;vertical-align:top}tr:last-child td{border-bottom:none}tr:nth-child(even) td{background:#fafafa}.tc{text-align:center}.mono{font-family:monospace;font-size:9px;color:#64748b}.gA,.gAp{color:#16a34a;font-weight:700}.gB,.gBp{color:#2563eb;font-weight:600}.gD{color:#d97706}.gF{color:#dc2626;font-weight:700}tfoot td{background:#f1f5f9;font-weight:700;font-size:9px;border-top:2px solid #e2e8f0}.sem-cls{color:#64748b;text-transform:capitalize;font-weight:400}.bx{display:inline-block;border-radius:20px;padding:2px 7px;font-size:9px;font-weight:600}.ok{background:#dcfce7;color:#16a34a}.warn{background:#fef9c3;color:#ca8a04}.err{background:#fee2e2;color:#dc2626}.blue{background:#eff6ff;color:#2563eb}.clr-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-bottom:12px}.clr-cell{border-radius:5px;border:1px solid #e2e8f0;padding:6px 3px;text-align:center}.clr-cell.ok{border-color:#bbf7d0;background:#f0fdf4}.clr-cell.err{border-color:#fecaca;background:#fff5f5}.clr-lbl{font-size:8px;color:#64748b;margin-bottom:2px}.clr-ck{font-size:12px;font-weight:700}.clr-ck.ok{color:#16a34a}.clr-ck.err{color:#dc2626}.feat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}.feat-cell{border:1px solid #e2e8f0;border-radius:5px;padding:6px 8px;background:#f8fafc}.feat-t{font-size:10px;font-weight:600;color:#1e293b}.feat-d{font-size:8px;color:#64748b;margin-top:2px}.kv-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:11px}.kv-cell{border:1px solid #e2e8f0;border-radius:5px;padding:6px 8px;background:#f8fafc}.kv-lbl{font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}.kv-val{font-size:10px;font-weight:600;color:#1e293b;margin-top:2px;word-break:break-all}.day-h{background:#eff6ff;color:#1d4ed8;font-weight:700;font-size:9px;padding:4px 8px;text-transform:uppercase;letter-spacing:.07em;border:1px solid #bfdbfe;margin-top:8px}.doc-footer{margin-top:18px;border-top:1px solid #e2e8f0;padding-top:7px;font-size:8px;color:#94a3b8;display:flex;justify-content:space-between}@media print{body{padding:0}@page{margin:11mm 13mm}thead{display:table-header-group}.sec-h{break-after:avoid}}`;

function buildPdfBody(snap: PortalSnapshotRow): string {
  const t = snap.content_type;
  const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const fallback = `<pre style="font-family:monospace;font-size:9px;white-space:pre-wrap;border:1px solid #e2e8f0;padding:10px;border-radius:4px">${esc(snap.text)}</pre>`;

  // ── Academic Results / Transcript ────────────────────────────────────────
  if (t === "Academic Results" || t === "Transcript") {
    const p = parseResultsText(snap.text);
    if (!p || p.semesters.length === 0) return fallback;
    const { student, semesters } = p;
    const latestCgpa = semesters.filter(s => s.cgpa !== null).at(-1)?.cgpa ?? null;
    const latestClass = semesters.filter(s => s.classification).at(-1)?.classification ?? "";
    let html = `<div class="student-box"><div><div class="sname">${student.name ?? ""}</div><div class="sdetail">${student.indexNumber ?? ""} &nbsp;|&nbsp; ${student.programme ?? ""}</div><div class="sdetail">${[student.certificateType && `Cert: ${student.certificateType}`, student.session && `Session: ${student.session}`, student.gradYear && `Grad Year: ${student.gradYear}`, student.dob && `DOB: ${student.dob}`].filter(Boolean).join(" · ")}</div></div>${latestCgpa !== null ? `<div><div class="cgpa">${latestCgpa.toFixed(3)}<small>CGPA</small></div><div class="cls">${latestClass}</div></div>` : ""}</div>`;
    for (const sem of semesters) {
      html += `<div class="sec-h">${sem.year} &nbsp;·&nbsp; Level ${sem.level} &nbsp;·&nbsp; Semester ${sem.semester}${sem.gpa !== null ? `<span class="gpa-pill">GPA ${sem.gpa.toFixed(3)}</span>` : ""}</div><table><thead><tr><th>Code</th><th>Course</th><th class="tc">CR</th><th class="tc">Score</th><th class="tc">Grade</th><th class="tc">GP</th></tr></thead><tbody>${sem.courses.map(c => `<tr><td class="mono">${c.code}</td><td>${c.name}</td><td class="tc">${c.credits}</td><td class="tc">${c.score ?? "—"}</td><td class="tc g${c.grade.replace("+", "p")}">${c.grade}</td><td class="tc">${c.gradePoints.toFixed(1)}</td></tr>`).join("")}</tbody>${sem.gpa !== null || sem.cgpa !== null ? `<tfoot><tr><td colspan="4" class="sem-cls">${sem.classification ?? ""}</td><td class="tc">${sem.gpa !== null ? `GPA ${sem.gpa.toFixed(3)}` : ""}</td><td class="tc">${sem.cgpa !== null ? sem.cgpa.toFixed(3) : ""}</td></tr></tfoot>` : ""}</table>`;
    }
    return html;
  }

  // ── Fee Statement ────────────────────────────────────────────────────────
  if (t === "Fee Statement") {
    const p = parseFeesText(snap.text);
    if (!p) return fallback;
    const hasBalance = !!(p.outstandingBalance && p.outstandingBalance !== "0" && p.outstandingBalance !== "0.0");
    let html = `<div class="student-box"><div><div class="sname">${p.name || "Fee Statement"}</div><div class="sdetail">${p.indexNumber}${p.programme ? ` &nbsp;|&nbsp; ${p.programme}` : ""}</div></div></div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:14px">`;
    html += `<div class="kv-cell"><div class="kv-lbl">Opening Balance</div><div class="kv-val">GHc ${p.openingBalance || "—"}</div></div>`;
    html += `<div class="kv-cell"><div class="kv-lbl">Total Fees</div><div class="kv-val">GHc ${p.totalFees || "—"}</div></div>`;
    html += `<div class="kv-cell"><div class="kv-lbl">Total Paid</div><div class="kv-val" style="color:#16a34a">GHc ${p.totalPaid || "—"}</div></div>`;
    html += `<div class="kv-cell" style="${hasBalance ? "border-color:#fecaca;background:#fff5f5" : ""}"><div class="kv-lbl">Outstanding</div><div class="kv-val" style="color:${hasBalance ? "#dc2626" : "#16a34a"}">GHc ${p.outstandingBalance || "0"}</div></div>`;
    html += `</div>`;
    if (p.resitCount || p.totalResitPaid) {
      html += `<div style="display:flex;gap:7px;margin-bottom:12px">`;
      if (p.resitCount) html += `<div class="kv-cell" style="flex:1"><div class="kv-lbl">Resit / Supplementary</div><div class="kv-val">${p.resitCount}</div></div>`;
      if (p.totalResitPaid) html += `<div class="kv-cell" style="flex:1"><div class="kv-lbl">Total Resit Paid</div><div class="kv-val">GHc ${p.totalResitPaid}</div></div>`;
      html += `</div>`;
    }
    if (p.items.length > 0) {
      html += `<div class="sec-h">Other Charges</div><table><thead><tr><th>Description</th><th class="tc">Amount</th></tr></thead><tbody>${p.items.map(i => `<tr><td>${i.description}</td><td class="tc mono">${i.amount}</td></tr>`).join("")}</tbody></table>`;
    }
    if (p.statementRows.length > 0) {
      html += `<div class="sec-h">Statement of Account</div><table><thead><tr><th>Date</th><th>Level</th><th>Type</th><th class="tc">Fees</th><th class="tc">Bill</th><th class="tc">Payment</th><th class="tc">Balance</th></tr></thead><tbody>${p.statementRows.map(r => { const bal = parseFloat(r.balance); const warn = !isNaN(bal) && bal > 0; return `<tr><td class="mono">${r.date}</td><td class="tc">${r.level}</td><td>${r.type}</td><td class="tc">${r.fees}</td><td class="tc">${r.bill}</td><td class="tc" style="color:#16a34a;font-weight:600">${r.payment}</td><td class="tc" style="color:${warn ? "#dc2626" : "#16a34a"};font-weight:600">${r.balance}</td></tr>`; }).join("")}</tbody></table>`;
    }
    return html;
  }

  // ── Student Profile ──────────────────────────────────────────────────────
  if (t === "Student Profile") {
    const p = parseBiodataText(snap.text);
    if (!p) return fallback;
    const fields = [["Index Number", p.indexNumber], ["Date of Birth", p.dob], ["Gender", p.gender], ["Nationality", p.nationality], ["Email", p.email], ["Phone", p.phone], ["Level", p.level]].filter(([, v]) => v);
    return `<div class="student-box"><div><div class="sname">${p.name || "Student"}</div><div class="sdetail">${p.programme}</div></div></div><div class="kv-grid">${fields.map(([l, v]) => `<div class="kv-cell"><div class="kv-lbl">${l}</div><div class="kv-val">${v}</div></div>`).join("")}</div>`;
  }

  // ── Student Dashboard / Home ─────────────────────────────────────────────
  if (t === "Student Dashboard" || t === "Student Home") {
    const p = parseDashboard(snap.text);
    if (!p) return fallback;
    const home = t === "Student Home" ? parseHomePage(snap.text) : null;
    let html = `<div class="student-box"><div><div class="sname">${p.name || "Student"}</div><div class="sdetail">${p.indexNumber} &nbsp;|&nbsp; ${p.programme}</div></div><span class="bx blue">${p.level}</span></div>`;
    html += `<p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:7px">Registration Clearance</p>`;
    html += `<div class="clr-grid">${[["Registered", p.status.reg], ["Assessment", p.status.ass], ["Biodata", p.status.bio], ["Physical", p.status.phy], ["X-ray", p.status.xray]].map(([l, v]) => { const ok = /yes/i.test(v as string); return `<div class="clr-cell ${ok ? "ok" : "err"}"><div class="clr-lbl">${l}</div><div class="clr-ck ${ok ? "ok" : "err"}">${ok ? "✓" : "✗"}</div><div class="bx ${ok ? "ok" : "err"}" style="margin-top:3px">${v}</div></div>`; }).join("")}</div>`;
    if (home && home.quickLinks.length > 0) {
      html += `<p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:7px;margin-top:13px">Portal Features</p>`;
      html += `<div class="feat-grid">${home.quickLinks.map(lk => `<div class="feat-cell"><div class="feat-t">${lk.title}</div><div class="feat-d">${lk.desc}</div></div>`).join("")}</div>`;
    }
    return html;
  }

  // ── Lecturing Timetable / Exams Timetable ────────────────────────────────
  if (t === "Lecturing Timetable" || t === "Exams Timetable") {
    const p = parseTimetableText(snap.text);
    if (!p || p.entries.length === 0) return fallback;
    if (p.isExam) {
      return `<div class="sec-h">Exams Timetable <span style="font-weight:400;font-size:9px;color:#64748b">${p.entries.length} exams</span></div><table><thead><tr><th>Code</th><th>Course</th><th>Date</th><th>Time</th><th>Venue</th></tr></thead><tbody>${p.entries.map(e => `<tr><td class="mono" style="color:#2563eb;font-weight:600">${e.code}</td><td style="font-weight:500">${e.course}</td><td>${e.day}</td><td class="mono">${e.time}</td><td>${e.venue}</td></tr>`).join("")}</tbody></table>`;
    } else {
      const byDay: Record<string, TimetableEntry[]> = {};
      for (const e of p.entries) (byDay[e.day === "anyDay" ? "Flexible" : e.day] ??= []).push(e);
      let html = "";
      for (const [day, entries] of Object.entries(byDay)) {
        html += `<div class="day-h">${day}</div><table><thead><tr><th>Code</th><th>Course</th><th>Time</th><th>Lecturer</th><th>Venue</th><th class="tc">CR</th></tr></thead><tbody>${entries.map(e => `<tr><td class="mono" style="color:#2563eb;font-weight:600">${e.code}</td><td style="font-weight:500">${e.course}</td><td class="mono">${e.time}</td><td>${e.lecturer || "—"}</td><td>${e.venue !== "N/A" ? e.venue : "—"}</td><td class="tc">${e.credits || "—"}</td></tr>`).join("")}</tbody></table>`;
      }
      return html;
    }
  }

  // ── Assessment / Lecturer Portal ─────────────────────────────────────────
  if (t === "Assessment" || t === "Lecturer Portal") {
    const p = parseAssessment(snap.text);
    if (!p) return fallback;
    let html = `<div class="student-box"><div><div class="sname">${p.name || "Student"}</div><div class="sdetail">${p.indexNumber}</div></div></div>`;
    if (p.noLecturers || p.lecturers.length === 0) {
      html += `<div style="text-align:center;padding:18px;color:#64748b;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc"><p style="font-size:12px;font-weight:600">No Lecturers to Assess</p><p style="font-size:10px;margin-top:3px">All assessments completed or none are currently due.</p></div>`;
    } else {
      const assessed = p.lecturers.filter(l => /assessed/i.test(l.status)).length;
      const pending = p.lecturers.length - assessed;
      html += `<div style="display:flex;gap:7px;margin-bottom:9px"><span class="bx ok">${assessed} Assessed</span>${pending > 0 ? `<span class="bx warn">${pending} Pending</span>` : ""}</div>`;
      html += `<div class="sec-h">Lecturer Assessment Status</div><table><thead><tr><th>Code</th><th>Course</th><th>Lecturer</th><th class="tc">Status</th></tr></thead><tbody>${p.lecturers.map(l => `<tr><td class="mono">${l.code}</td><td>${l.course}</td><td>${l.name}</td><td class="tc"><span class="bx ${/assessed/i.test(l.status) ? "ok" : "warn"}">${l.status}</span></td></tr>`).join("")}</tbody></table>`;
    }
    return html;
  }

  // ── Industrial Liaison / Attachment / Assumption ─────────────────────────
  if (t === "Industrial Liaison" || t === "Attachment Letter" || t === "Assumption Form") {
    const p = parseLiaison(snap.text);
    if (!p) return fallback;
    const details = [["Company", p.company], ["Supervisor", p.supervisor], ["Start Date", p.startDate], ["End Date", p.endDate]].filter(([, v]) => v);
    let html = `<div class="student-box"><div><div class="sname">${p.name || "Student"}</div><div class="sdetail">${p.indexNumber}</div></div></div>`;
    if (details.length > 0) html += `<div class="kv-grid">${details.map(([l, v]) => `<div class="kv-cell"><div class="kv-lbl">${l}</div><div class="kv-val">${v}</div></div>`).join("")}</div>`;
    if (p.items.length > 0) html += `<div class="sec-h">Details</div><table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${p.items.map(i => `<tr><td style="color:#64748b;width:35%">${i.label}</td><td style="font-weight:600">${i.value}</td></tr>`).join("")}</tbody></table>`;
    return html;
  }

  // ── Generic ──────────────────────────────────────────────────────────────
  const pg = parseGenericPortalPage(snap.text, t);
  let html = "";
  if (pg.name || pg.indexNumber) html += `<div class="student-box"><div><div class="sname">${pg.name || t}</div><div class="sdetail">${pg.indexNumber}</div></div></div>`;
  if (pg.items.length > 0) html += `<div class="sec-h">${t}</div><table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${pg.items.map(i => `<tr><td style="color:#64748b;width:35%">${i.label}</td><td style="font-weight:600">${i.value}</td></tr>`).join("")}</tbody></table>`;
  else html += fallback;
  return html;
}

// ── PDF — single snapshot ─────────────────────────────────────────────────────

function downloadSingleAsPdf(snap: PortalSnapshotRow) {
  const body = buildPdfBody(snap);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>${snap.content_type} — TTU LoadShield</title><style>${PDF_CSS}</style></head><body><div class="doc-header"><div><div class="doc-title">${snap.content_type}</div><div class="doc-sub">TTU LoadShield · Portal History</div></div><div class="doc-meta"><div>Captured: ${new Date(snap.captured_at).toLocaleString()}</div><div>Path: ${snap.path}</div></div></div>${body}<div class="doc-footer"><span>TTU LoadShield — Portal History Report</span><span>Generated ${new Date().toLocaleString()}</span></div><script>window.onload=()=>{window.print();}<\/script></body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

// ── PDF / HTML — all snapshots (bulk download) ────────────────────────────────

function downloadSnapshots(snapshots: PortalSnapshotRow[], userName?: string) {
  const name = userName ?? "Student";
  const sectionStyles = `.wrap{border:1px solid #e2e8f0;border-radius:7px;overflow:hidden;margin-bottom:22px;page-break-inside:avoid}.s-head{background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:7px 13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.s-badge{background:#eff6ff;color:#2563eb;border-radius:20px;padding:2px 8px;font-size:9px;font-weight:600}.s-path{font-family:monospace;font-size:9px;color:#64748b}.s-date{margin-left:auto;font-size:9px;color:#94a3b8}.s-body{padding:13px}.sec-h{margin-top:8px}`;
  const sections = snapshots.map(snap => {
    const body = buildPdfBody(snap);
    return `<div class="wrap"><div class="s-head"><span class="s-badge">${snap.content_type}</span><span class="s-path">${snap.path}</span><span class="s-date">${new Date(snap.captured_at).toLocaleString()}</span></div><div class="s-body">${body}</div></div>`;
  }).join("");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Portal History — ${name}</title><style>${PDF_CSS}${sectionStyles}h1{font-size:17px;font-weight:800;margin-bottom:3px}.meta{font-size:10px;color:#64748b;margin-bottom:20px}</style></head><body><div class="doc-header"><div><div class="doc-title">Portal History Report</div><div class="doc-sub">TTU LoadShield</div></div><div class="doc-meta"><div>Student: ${name}</div><div>Generated: ${new Date().toLocaleString()}</div></div></div><div class="meta">${snapshots.length} snapshot${snapshots.length !== 1 ? "s" : ""} captured</div>${sections}<div class="doc-footer"><span>TTU LoadShield — Portal History Report</span><span>${name} · ${new Date().toLocaleString()}</span></div></body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `portal-history-${new Date().toISOString().slice(0, 10)}.html`; a.click();
  URL.revokeObjectURL(url);
}

// ── Supabase sync ─────────────────────────────────────────────────────────────

// Pages that should only be saved to Supabase once per calendar day
const DAILY_ONLY = new Set(["Student Dashboard", "Student Home"]);

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
}

async function syncToSupabase(userId: string, gatewaySnapshots: GatewaySnapshot[], gatewayChanges: GatewayChange[], syncedChangeIds: Set<string>) {
  // For daily-only pages, only upsert if we haven't already saved one today
  await Promise.allSettled(gatewaySnapshots.map(async s => {
    if (DAILY_ONLY.has(s.contentType)) {
      // Check if we already have a snapshot for today from Supabase
      const captured = new Date(s.capturedAt).toLocaleDateString("en-CA");
      if (captured !== todayStr()) return; // stale — gateway restart carried over yesterday's snapshot
    }
    return upsertPortalSnapshot(userId, {
      session_id: s.sessionId,
      path: s.path,
      content_type: s.contentType,
      hash: s.hash,
      text: s.text,
      captured_at: new Date(s.capturedAt).toISOString(),
    });
  }));
  const newChanges = gatewayChanges.filter(c => !syncedChangeIds.has(c.id));
  await Promise.allSettled(newChanges.map(c => insertPortalChange(userId, { session_id: c.sessionId, path: c.path, content_type: c.contentType, before_text: c.before.text, before_captured_at: new Date(c.before.capturedAt).toISOString(), after_text: c.after.text, after_captured_at: new Date(c.after.capturedAt).toISOString(), detected_at: new Date(c.detectedAt).toISOString() })));
  newChanges.forEach(c => syncedChangeIds.add(c.id));
}

// ── Shared card shell ─────────────────────────────────────────────────────────

function SnapCard({ icon, label, path, capturedAt, summary, onView }: { icon: React.ReactNode; label: string; path: string; capturedAt: string; summary: React.ReactNode; onView: () => void; }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border bg-primary/5 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-foreground">{label}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">{path}</p>
        </div>
      </div>
      <div className="flex-1 px-4 py-3 text-xs text-muted-foreground leading-relaxed">{summary}</div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <span className="text-[11px] text-muted-foreground">{formatDate(capturedAt)}</span>
        <button onClick={onView} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
          View <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── Summary components ────────────────────────────────────────────────────────

function ResultsSummary({ text }: { text: string }) {
  const p = parseResultsText(text);
  if (!p) return <span className="line-clamp-3">{truncate(text, 120)}</span>;
  const cgpa = p.semesters.filter(s => s.cgpa !== null).at(-1)?.cgpa ?? null;
  const cls = p.semesters.filter(s => s.classification).at(-1)?.classification ?? "";
  const totalCourses = p.semesters.reduce((n, s) => n + s.courses.length, 0);
  return (
    <div className="space-y-2">
      <p className="font-semibold text-foreground text-xs truncate">{p.student.name || "—"}</p>
      <p className="text-[11px] font-mono text-muted-foreground">{p.student.indexNumber}</p>
      {cgpa !== null && <p className={`text-lg font-extrabold ${gpaColor(cgpa)}`}>{cgpa.toFixed(3)} <span className="text-[10px] font-normal text-muted-foreground">CGPA</span></p>}
      <p className="text-[11px] text-muted-foreground capitalize">{cls} · {p.semesters.length} semesters · {totalCourses} courses</p>
    </div>
  );
}

function FeesSummary({ text }: { text: string }) {
  const p = parseFeesText(text);
  if (!p) return <span className="line-clamp-3">{truncate(text, 120)}</span>;
  const hasBalance = p.outstandingBalance && p.outstandingBalance !== "0" && p.outstandingBalance !== "0.0";
  return (
    <div className="space-y-2">
      <p className="font-semibold text-foreground text-xs truncate">{p.name || "Fee Statement"}</p>
      <div className="grid grid-cols-2 gap-1.5 mt-1">
        <div className="rounded-md bg-accent/40 px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">Total Fees</p>
          <p className="text-xs font-bold text-foreground">GHc {p.totalFees || "—"}</p>
        </div>
        <div className={`rounded-md px-2 py-1.5 text-center ${hasBalance ? "bg-destructive/10" : "bg-[color:var(--success)]/10"}`}>
          <p className="text-[10px] text-muted-foreground">Outstanding</p>
          <p className={`text-xs font-bold ${hasBalance ? "text-destructive" : "text-[color:var(--success)]"}`}>
            GHc {p.outstandingBalance || "0"}
          </p>
        </div>
      </div>
      {p.statementRows.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{p.statementRows.length} payment records</p>
      )}
    </div>
  );
}

function BioSummary({ text }: { text: string }) {
  const p = parseBiodataText(text);
  if (!p) return <span className="line-clamp-3">{truncate(text, 120)}</span>;
  return (
    <div className="space-y-1">
      <p className="font-semibold text-foreground text-xs truncate">{p.name || "—"}</p>
      {p.programme && <p className="text-[11px] text-muted-foreground line-clamp-2">{p.programme}</p>}
      {p.level && <p className="text-[11px] text-muted-foreground">Level: {p.level}</p>}
      {p.dob && <p className="text-[11px] text-muted-foreground">DOB: {p.dob}</p>}
    </div>
  );
}

function DashboardSummary({ text }: { text: string }) {
  const p = parseDashboard(text);
  if (!p) return <span className="line-clamp-3">{truncate(text, 120)}</span>;
  const allGood = Object.values(p.status).every(v => /yes/i.test(v));
  return (
    <div className="space-y-2">
      <p className="font-semibold text-foreground text-xs truncate">{p.name || "—"}</p>
      <p className="text-[11px] text-muted-foreground truncate">{p.level}{p.programme ? ` · ${p.programme}` : ""}</p>
      <div className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${allGood ? "bg-[color:var(--success)]/10 text-[color:var(--success)]" : "bg-[color:var(--warning)]/10 text-[color:var(--warning)]"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${allGood ? "bg-[color:var(--success)]" : "bg-[color:var(--warning)]"}`} />
        {allGood ? "All checks passed" : "Some checks pending"}
      </div>
      <div className="grid grid-cols-5 gap-1 pt-1">
        {[["Reg", p.status.reg], ["Ass", p.status.ass], ["Bio", p.status.bio], ["Phy", p.status.phy], ["X-ray", p.status.xray]].map(([l, v]) => (
          <div key={l} className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground">{l}</span>
            <span className={`text-[10px] font-bold ${/yes/i.test(v) ? "text-[color:var(--success)]" : "text-destructive"}`}>{/yes/i.test(v) ? "✓" : "✗"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimetableSummary({ text }: { text: string }) {
  const p = parseTimetableText(text);
  if (!p) return <span className="line-clamp-3">{truncate(text, 120)}</span>;
  const days = [...new Set(p.entries.filter(e => e.day && e.day !== "N/A" && e.day !== "anyDay").map(e => e.day.split(",")[0]))];
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">{p.title}</p>
      <p className="text-[11px] text-muted-foreground">{p.entries.length} course{p.entries.length !== 1 ? "s" : ""}{days.length > 0 ? ` · ${days.length} day${days.length !== 1 ? "s" : ""}` : ""}</p>
      {p.isExam ? (
        <div className="flex flex-wrap gap-1 mt-1">
          {p.entries.slice(0, 3).map((e, i) => (
            <span key={i} className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">{e.code}</span>
          ))}
          {p.entries.length > 3 && <span className="text-[10px] text-muted-foreground">+{p.entries.length - 3} more</span>}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1 mt-1">
          {days.slice(0, 4).map(d => <span key={d} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{d.slice(0, 3)}</span>)}
        </div>
      )}
    </div>
  );
}

function HomeSummary({ text }: { text: string }) {
  const p = parseHomePage(text);
  if (!p) return <span className="line-clamp-3">{truncate(text, 120)}</span>;
  const allGood = Object.values(p.status).every(v => /yes/i.test(v));
  return (
    <div className="space-y-2">
      <p className="font-semibold text-foreground text-xs truncate">{p.name || "—"}</p>
      <p className="text-[11px] text-muted-foreground truncate">{p.level}{p.programme ? ` · ${p.programme}` : ""}</p>
      <div className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${allGood ? "bg-[color:var(--success)]/10 text-[color:var(--success)]" : "bg-[color:var(--warning)]/10 text-[color:var(--warning)]"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${allGood ? "bg-[color:var(--success)]" : "bg-[color:var(--warning)]"}`} />
        {allGood ? "All clearance checks passed" : "Some checks pending"}
      </div>
      <p className="text-[11px] text-muted-foreground">{p.quickLinks.length} portal features available</p>
    </div>
  );
}

function CourseRegSummary({ text }: { text: string }) {
  const p = parseCourseRegistration(text);
  if (!p || p.courses.length === 0) return <span className="line-clamp-3">{truncate(text, 120)}</span>;
  return (
    <div className="space-y-2">
      <p className="font-semibold text-foreground text-xs truncate">{p.name || "—"}</p>
      <p className="text-[11px] text-muted-foreground">{p.level ? `Level ${p.level}` : ""}{p.semester ? ` · Semester ${p.semester}` : ""}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{p.courses.length} courses</span>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-muted-foreground">{p.totalCredits} credits</span>
      </div>
    </div>
  );
}

function AssessmentSummary({ text }: { text: string }) {
  const p = parseAssessment(text);
  if (!p) return <span className="line-clamp-3">{truncate(text, 120)}</span>;
  const assessed = p.lecturers.filter(l => /assessed/i.test(l.status)).length;
  const pending = p.lecturers.filter(l => /pending/i.test(l.status)).length;
  return (
    <div className="space-y-2">
      <p className="font-semibold text-foreground text-xs truncate">{p.name || "—"}</p>
      {p.lecturers.length > 0 ? (
        <div className="flex gap-2 mt-1">
          <span className="rounded-full bg-[color:var(--success)]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--success)]">{assessed} assessed</span>
          {pending > 0 && <span className="rounded-full bg-[color:var(--warning)]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--warning)]">{pending} pending</span>}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Lecturer assessments captured</p>
      )}
    </div>
  );
}

function LiaisonSummary({ text }: { text: string }) {
  const p = parseLiaison(text);
  if (!p) return <span className="line-clamp-3">{truncate(text, 120)}</span>;
  return (
    <div className="space-y-1.5">
      <p className="font-semibold text-foreground text-xs truncate">{p.name || "—"}</p>
      {p.company && <p className="text-[11px] text-muted-foreground truncate"><span className="font-medium text-foreground">Company:</span> {p.company}</p>}
      {p.startDate && <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">From:</span> {p.startDate}{p.endDate ? ` → ${p.endDate}` : ""}</p>}
      {!p.company && <p className="text-[11px] text-muted-foreground">Industrial liaison data captured</p>}
    </div>
  );
}

function GenericPortalSummary({ text, contentType }: { text: string; contentType: string }) {
  const p = parseGenericPortalPage(text, contentType);
  return (
    <div className="space-y-1.5">
      {p.name && <p className="font-semibold text-foreground text-xs truncate">{p.name}</p>}
      {p.items.length > 0 ? (
        <div className="space-y-1">
          {p.items.slice(0, 3).map((item, i) => (
            <div key={i} className="flex gap-1.5 text-[11px]">
              <span className="shrink-0 text-muted-foreground">{item.label}:</span>
              <span className="truncate font-medium text-foreground">{item.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground line-clamp-3">{truncate(text, 140)}</p>
      )}
    </div>
  );
}

function SnapshotCard({ snap, onView }: { snap: PortalSnapshotRow; onView: () => void }) {
  const t = snap.content_type;
  const icon = <ContentIcon label={t} className="h-4 w-4" />;
  const summary =
    t === "Academic Results" || t === "Transcript" ? <ResultsSummary text={snap.text} /> :
    t === "Fee Statement" ? <FeesSummary text={snap.text} /> :
    t === "Student Profile" ? <BioSummary text={snap.text} /> :
    t === "Student Dashboard" ? <DashboardSummary text={snap.text} /> :
    t === "Student Home" ? <HomeSummary text={snap.text} /> :
    t === "Lecturing Timetable" || t === "Exams Timetable" ? <TimetableSummary text={snap.text} /> :
    t === "Course Registration" || t === "Registration Steps" || t === "Resit Registration" ? <CourseRegSummary text={snap.text} /> :
    t === "Assessment" ? <AssessmentSummary text={snap.text} /> :
    t === "Industrial Liaison" || t === "Attachment Letter" || t === "Assumption Form" ? <LiaisonSummary text={snap.text} /> :
    <GenericPortalSummary text={snap.text} contentType={t} />;
  return <SnapCard icon={icon} label={t} path={snap.path} capturedAt={snap.captured_at} summary={summary} onView={onView} />;
}

// ── Full-detail modal ─────────────────────────────────────────────────────────

function SnapshotModal({ snap, onClose }: { snap: PortalSnapshotRow | null; onClose: () => void }) {
  const [openSems, setOpenSems] = useState<Set<string>>(new Set(["0"]));
  function toggleSem(k: string) { setOpenSems(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; }); }
  if (!snap) return null;

  const t = snap.content_type;
  const parsedResults = (t === "Academic Results" || t === "Transcript") ? parseResultsText(snap.text) : null;
  const parsedFees = t === "Fee Statement" ? parseFeesText(snap.text) : null;
  const parsedBio = t === "Student Profile" ? parseBiodataText(snap.text) : null;
  const parsedDash = t === "Student Dashboard" ? parseDashboard(snap.text) : null;
  const parsedHome = t === "Student Home" ? parseHomePage(snap.text) : null;
  const parsedTt = (t === "Lecturing Timetable" || t === "Exams Timetable") ? parseTimetableText(snap.text) : null;
  const parsedCourseReg = (t === "Course Registration" || t === "Registration Steps" || t === "Resit Registration") ? parseCourseRegistration(snap.text) : null;
  const parsedAssess = t === "Assessment" ? parseAssessment(snap.text) : null;
  const parsedLiaison = (t === "Industrial Liaison" || t === "Attachment Letter" || t === "Assumption Form") ? parseLiaison(snap.text) : null;
  const parsedGeneric = (!parsedResults && !parsedFees && !parsedBio && !parsedDash && !parsedHome && !parsedTt && !parsedCourseReg && !parsedAssess && !parsedLiaison) ? parseGenericPortalPage(snap.text, t) : null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ duration: 0.2 }} className="fixed inset-x-4 top-[5vh] z-50 mx-auto max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ContentIcon label={snap.content_type} className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">{snap.content_type}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{snap.path} · {formatDate(snap.captured_at)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadSingleAsPdf(snap)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
              <Download className="h-3.5 w-3.5" /> Download PDF
            </button>
            <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors" aria-label="Close">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-5">

          {/* Academic Results */}
          {parsedResults && parsedResults.semesters.length > 0 && (() => {
            const { student, semesters } = parsedResults;
            const latestCgpa = semesters.filter(s => s.cgpa !== null).at(-1)?.cgpa ?? null;
            const latestClass = semesters.filter(s => s.classification).at(-1)?.classification ?? "";
            return (
              <>
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-primary/5 px-5 py-4">
                  <div>
                    <p className="text-base font-bold text-foreground">{student.name || "Student"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{student.indexNumber && <span className="font-mono mr-3">{student.indexNumber}</span>}{student.programme}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      {student.certificateType && <span><b className="text-foreground">Cert:</b> {student.certificateType}</span>}
                      {student.session && <span><b className="text-foreground">Session:</b> {student.session}</span>}
                      {student.gradYear && <span><b className="text-foreground">Grad Year:</b> {student.gradYear}</span>}
                      {student.dob && <span><b className="text-foreground">DOB:</b> {student.dob}</span>}
                    </div>
                  </div>
                  {latestCgpa !== null && (
                    <div className="text-right">
                      <p className={`text-3xl font-extrabold ${gpaColor(latestCgpa)}`}>{latestCgpa.toFixed(3)}<span className="ml-1 text-xs font-normal text-muted-foreground">CGPA</span></p>
                      {latestClass && <p className="text-xs text-muted-foreground capitalize mt-0.5">{latestClass}</p>}
                    </div>
                  )}
                </div>
                <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                  {semesters.map((sem, idx) => {
                    const key = String(idx);
                    const isOpen = openSems.has(key);
                    return (
                      <div key={key}>
                        <button onClick={() => toggleSem(key)} className="flex w-full items-center justify-between bg-accent/30 px-4 py-3 text-left hover:bg-accent/50 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground">{sem.year} · Level {sem.level} · Semester {sem.semester}</span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{sem.courses.length} courses</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {sem.gpa !== null && <span className={`text-sm font-bold ${gpaColor(sem.gpa)}`}>GPA {sem.gpa.toFixed(3)}</span>}
                            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                          </div>
                        </button>
                        <AnimatePresence>
                          {isOpen && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[480px] text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                                      <th className="px-4 py-2">Code</th><th className="px-4 py-2">Course</th>
                                      <th className="px-4 py-2 text-center">CR</th><th className="px-4 py-2 text-center">Score</th>
                                      <th className="px-4 py-2 text-center">Grade</th><th className="px-4 py-2 text-center">GP</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sem.courses.map((c, ci) => (
                                      <tr key={ci} className="border-b border-border/40 last:border-0 hover:bg-accent/20">
                                        <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{c.code}</td>
                                        <td className="px-4 py-2 text-foreground">{c.name}</td>
                                        <td className="px-4 py-2 text-center text-muted-foreground">{c.credits}</td>
                                        <td className="px-4 py-2 text-center text-muted-foreground">{c.score ?? "—"}</td>
                                        <td className={`px-4 py-2 text-center font-semibold ${gradeColor(c.grade)}`}>{c.grade}</td>
                                        <td className="px-4 py-2 text-center text-muted-foreground">{c.gradePoints.toFixed(1)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  {(sem.gpa !== null || sem.cgpa !== null) && (
                                    <tfoot>
                                      <tr className="border-t border-border bg-accent/30">
                                        <td colSpan={4} className="px-4 py-2 text-right text-[10px] text-muted-foreground capitalize">{sem.classification}</td>
                                        <td className="px-4 py-2 text-center text-[11px] font-bold">{sem.gpa !== null && <span className={gpaColor(sem.gpa)}>GPA {sem.gpa.toFixed(3)}</span>}</td>
                                        <td className="px-4 py-2 text-center text-[11px] font-bold">{sem.cgpa !== null && <span className={gpaColor(sem.cgpa)}>{sem.cgpa.toFixed(3)}</span>}</td>
                                      </tr>
                                    </tfoot>
                                  )}
                                </table>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}

          {/* Fee Statement */}
          {parsedFees && (
            <>
              {/* Summary header */}
              <div className="mb-4 rounded-xl border border-border bg-primary/5 px-5 py-4">
                <p className="text-base font-bold text-foreground">{parsedFees.name || "Fee Statement"}</p>
                {parsedFees.indexNumber && <p className="font-mono text-xs text-muted-foreground mt-0.5">{parsedFees.indexNumber}</p>}
                {parsedFees.programme && <p className="text-xs text-muted-foreground">{parsedFees.programme}</p>}
              </div>

              {/* Key figures grid */}
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Opening Balance", `GHc ${parsedFees.openingBalance}`, false],
                  ["Total Fees", `GHc ${parsedFees.totalFees}`, false],
                  ["Total Paid", `GHc ${parsedFees.totalPaid}`, false],
                  ["Outstanding", `GHc ${parsedFees.outstandingBalance}`,
                    !!(parsedFees.outstandingBalance && parsedFees.outstandingBalance !== "0" && parsedFees.outstandingBalance !== "0.0")],
                ].map(([label, val, warn]) => (
                  <div key={label as string} className={`rounded-xl border px-4 py-3 text-center ${warn ? "border-destructive/30 bg-destructive/5" : "border-border bg-accent/20"}`}>
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className={`mt-1 text-sm font-extrabold ${warn ? "text-destructive" : "text-foreground"}`}>{(val as string) || "—"}</p>
                  </div>
                ))}
              </div>

              {/* Resit info */}
              {(parsedFees.resitCount || parsedFees.totalResitPaid) && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {parsedFees.resitCount && (
                    <div className="rounded-lg border border-border bg-accent/20 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Resit / Supplementary</p>
                      <p className="text-xs font-bold text-foreground">{parsedFees.resitCount}</p>
                    </div>
                  )}
                  {parsedFees.totalResitPaid && (
                    <div className="rounded-lg border border-border bg-accent/20 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Total Resit Paid</p>
                      <p className="text-xs font-bold text-foreground">GHc {parsedFees.totalResitPaid}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Misc charges */}
              {parsedFees.items.length > 0 && (
                <div className="mb-4 rounded-xl border border-border overflow-hidden">
                  <div className="bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Other Charges</div>
                  {parsedFees.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between border-t border-border/50 px-4 py-2.5 text-xs hover:bg-accent/20">
                      <span className="text-muted-foreground">{item.description}</span>
                      <span className="font-mono font-semibold text-foreground">{item.amount}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Statement of account table */}
              {parsedFees.statementRows.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Statement of Account ({parsedFees.statementRows.length} records)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2">Date</th>
                          <th className="px-4 py-2">Level</th>
                          <th className="px-4 py-2">Type</th>
                          <th className="px-4 py-2 text-right">Fees (GHc)</th>
                          <th className="px-4 py-2 text-right">Bill (GHc)</th>
                          <th className="px-4 py-2 text-right">Payment (GHc)</th>
                          <th className="px-4 py-2 text-right">Balance (GHc)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedFees.statementRows.map((row, i) => {
                          const bal = parseFloat(row.balance);
                          return (
                            <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-accent/20">
                              <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">{row.date}</td>
                              <td className="px-4 py-2 text-center">
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{row.level}</span>
                              </td>
                              <td className="px-4 py-2 text-foreground">{row.type}</td>
                              <td className="px-4 py-2 text-right font-mono">{row.fees}</td>
                              <td className="px-4 py-2 text-right font-mono">{row.bill}</td>
                              <td className="px-4 py-2 text-right font-mono text-[color:var(--success)] font-semibold">{row.payment}</td>
                              <td className={`px-4 py-2 text-right font-mono font-semibold ${!isNaN(bal) && bal > 0 ? "text-destructive" : "text-[color:var(--success)]"}`}>
                                {row.balance}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Student Profile */}
          {parsedBio && (
            <>
              <div className="mb-4 rounded-xl border border-border bg-primary/5 px-5 py-4">
                <p className="text-base font-bold text-foreground">{parsedBio.name || "Student"}</p>
                {parsedBio.programme && <p className="text-xs text-muted-foreground mt-0.5">{parsedBio.programme}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[["Index Number", parsedBio.indexNumber], ["Date of Birth", parsedBio.dob], ["Gender", parsedBio.gender], ["Nationality", parsedBio.nationality], ["Email", parsedBio.email], ["Phone", parsedBio.phone], ["Level", parsedBio.level]].filter(([, v]) => v).map(([l, v]) => (
                  <div key={l as string} className="rounded-lg border border-border bg-accent/20 px-3 py-2.5">
                    <p className="text-[10px] text-muted-foreground">{l}</p>
                    <p className="mt-0.5 text-xs font-semibold text-foreground break-all">{v}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Dashboard */}
          {parsedDash && (
            <>
              <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-border bg-primary/5 px-5 py-4">
                <div>
                  <p className="text-base font-bold text-foreground">{parsedDash.name || "Student"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{parsedDash.indexNumber && <span className="font-mono mr-2">{parsedDash.indexNumber}</span>}{parsedDash.programme}</p>
                </div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary shrink-0">{parsedDash.level}</span>
              </div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Registration Clearance</p>
              <div className="mb-5 grid grid-cols-5 gap-2">
                {[["Registered", parsedDash.status.reg], ["Assessment", parsedDash.status.ass], ["Biodata", parsedDash.status.bio], ["Physical", parsedDash.status.phy], ["X-ray", parsedDash.status.xray]].map(([l, v]) => {
                  const ok = /yes/i.test(v as string);
                  return (
                    <div key={l as string} className={`flex flex-col items-center gap-2 rounded-xl border px-2 py-3 ${ok ? "border-[color:var(--success)]/30 bg-[color:var(--success)]/5" : "border-destructive/30 bg-destructive/5"}`}>
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${ok ? "bg-[color:var(--success)]/15 text-[color:var(--success)]" : "bg-destructive/15 text-destructive"}`}>{ok ? "✓" : "✗"}</span>
                      <span className="text-center text-[10px] leading-tight text-muted-foreground">{l}</span>
                      {statusBadge(v as string)}
                    </div>
                  );
                })}
              </div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Portal Features</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[["Check Results", "Access exam scores and grade reports"], ["Register Courses", "Enroll in courses for the current semester"], ["Fee Payments", "View financial statement and track payments"], ["Lecturing Timetable", "View weekly lecture schedule"], ["Exams Timetable", "Check examination dates and venues"], ["Industrial Liaison", "Generate attachment request letters"], ["Assess Lecturers", "Provide feedback on course delivery"], ["E-Library", "Access digital books and journals"], ["Graduation", "Apply and check clearance status"]].map(([title, desc]) => (
                  <div key={title as string} className="rounded-lg border border-border bg-accent/20 px-3 py-2.5">
                    <p className="text-xs font-semibold text-foreground">{title}</p>
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{desc}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Timetable */}
          {parsedTt && parsedTt.entries.length > 0 && (() => {
            if (parsedTt.isExam) {
              // Exams timetable — list by date
              return (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="bg-destructive/5 border-b border-border px-4 py-3 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-destructive" />
                    <p className="text-sm font-bold text-foreground">Exams Timetable</p>
                    <span className="ml-auto text-[11px] text-muted-foreground">{parsedTt.entries.length} exams</span>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2">Code</th>
                        <th className="px-4 py-2">Course</th>
                        <th className="px-4 py-2">Date</th>
                        <th className="px-4 py-2">Time</th>
                        <th className="px-4 py-2">Venue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedTt.entries.map((e, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-accent/20">
                          <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-primary">{e.code}</td>
                          <td className="px-4 py-2.5 font-medium text-foreground">{e.course}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{e.day}</td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{e.time}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{e.venue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            } else {
              // Lecturing timetable — group by day
              const byDay: Record<string, typeof parsedTt.entries> = {};
              for (const e of parsedTt.entries) (byDay[e.day === "anyDay" ? "Flexible" : e.day] ??= []).push(e);
              return (
                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                  {Object.entries(byDay).map(([day, entries]) => (
                    <div key={day}>
                      <div className="bg-primary/5 px-4 py-2 flex items-center gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{day}</p>
                        <span className="text-[10px] text-muted-foreground">{entries.length} class{entries.length !== 1 ? "es" : ""}</span>
                      </div>
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-1.5">Code</th>
                            <th className="px-4 py-1.5">Course</th>
                            <th className="px-4 py-1.5">Time</th>
                            <th className="px-4 py-1.5">Lecturer</th>
                            <th className="px-4 py-1.5">Venue</th>
                            <th className="px-4 py-1.5 text-center">CR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map((e, i) => (
                            <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-accent/20">
                              <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-primary">{e.code}</td>
                              <td className="px-4 py-2.5 font-medium text-foreground">{e.course}</td>
                              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{e.time}</td>
                              <td className="px-4 py-2.5 text-muted-foreground">{e.lecturer || "—"}</td>
                              <td className="px-4 py-2.5 text-muted-foreground">{e.venue !== "N/A" ? e.venue : "—"}</td>
                              <td className="px-4 py-2.5 text-center text-muted-foreground">{e.credits || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              );
            }
          })()}

          {/* Student Home */}
          {parsedHome && (
            <>
              <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-border bg-primary/5 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="rounded-full bg-[color:var(--success)]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--success)]">Welcome back</span>
                  </div>
                  <p className="text-base font-bold text-foreground">{parsedHome.name || "Student"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {parsedHome.indexNumber && <span className="font-mono mr-2">{parsedHome.indexNumber}</span>}
                    {parsedHome.programme}
                  </p>
                </div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary shrink-0">{parsedHome.level}</span>
              </div>

              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Clearance Status</p>
              <div className="mb-5 grid grid-cols-5 gap-2">
                {[["Registered", parsedHome.status.reg], ["Assessment", parsedHome.status.ass], ["Biodata", parsedHome.status.bio], ["Physical", parsedHome.status.phy], ["X-ray", parsedHome.status.xray]].map(([l, v]) => {
                  const ok = /yes/i.test(v as string);
                  return (
                    <div key={l as string} className={`flex flex-col items-center gap-2 rounded-xl border px-2 py-3 ${ok ? "border-[color:var(--success)]/30 bg-[color:var(--success)]/5" : "border-destructive/30 bg-destructive/5"}`}>
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${ok ? "bg-[color:var(--success)]/15 text-[color:var(--success)]" : "bg-destructive/15 text-destructive"}`}>{ok ? "✓" : "✗"}</span>
                      <span className="text-center text-[10px] leading-tight text-muted-foreground">{l}</span>
                      {statusBadge(v as string)}
                    </div>
                  );
                })}
              </div>

              {parsedHome.quickLinks.length > 0 && (
                <>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Available Portal Features</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {parsedHome.quickLinks.map((lk) => (
                      <div key={lk.title} className="rounded-lg border border-border bg-accent/20 px-3 py-2.5">
                        <p className="text-xs font-semibold text-foreground">{lk.title}</p>
                        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{lk.desc}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* Course Registration */}
          {parsedCourseReg && (
            <>
              <div className="mb-4 rounded-xl border border-border bg-primary/5 px-5 py-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-foreground">{parsedCourseReg.name || "Student"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{parsedCourseReg.indexNumber && <span className="font-mono mr-2">{parsedCourseReg.indexNumber}</span>}</p>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  {parsedCourseReg.level && <span className="block rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Level {parsedCourseReg.level}</span>}
                  {parsedCourseReg.semester && <span className="block rounded-full bg-accent px-3 py-1 text-xs text-muted-foreground">Semester {parsedCourseReg.semester}</span>}
                </div>
              </div>
              {parsedCourseReg.courses.length > 0 ? (
                <>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{parsedCourseReg.courses.length} courses registered</span>
                    <span className="rounded-full bg-accent px-3 py-1 text-xs text-muted-foreground">{parsedCourseReg.totalCredits} total credits</span>
                  </div>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2">Code</th><th className="px-4 py-2">Course</th>
                          <th className="px-4 py-2 text-center">Credits</th><th className="px-4 py-2">Lecturer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedCourseReg.courses.map((c, i) => (
                          <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-accent/20">
                            <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{c.code}</td>
                            <td className="px-4 py-2 font-medium text-foreground">{c.name}</td>
                            <td className="px-4 py-2 text-center text-muted-foreground">{c.credits}</td>
                            <td className="px-4 py-2 text-muted-foreground text-[11px]">{c.lecturer || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <pre className="whitespace-pre-wrap rounded-xl border border-border bg-accent/20 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">{snap.text}</pre>
              )}
            </>
          )}

          {/* Assessment */}
          {parsedAssess && (
            <>
              <div className="mb-4 rounded-xl border border-border bg-primary/5 px-5 py-4">
                <p className="text-base font-bold text-foreground">{parsedAssess.name || "Student"}</p>
                {parsedAssess.indexNumber && <p className="font-mono text-xs text-muted-foreground mt-0.5">{parsedAssess.indexNumber}</p>}
              </div>
              {parsedAssess.lecturers.length > 0 ? (
                <>
                  <div className="mb-3 flex gap-2">
                    <span className="rounded-full bg-[color:var(--success)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--success)]">{parsedAssess.lecturers.filter(l => /assessed/i.test(l.status)).length} assessed</span>
                    <span className="rounded-full bg-[color:var(--warning)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--warning)]">{parsedAssess.lecturers.filter(l => /pending/i.test(l.status)).length} pending</span>
                  </div>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2">Code</th><th className="px-4 py-2">Course</th>
                          <th className="px-4 py-2">Lecturer</th><th className="px-4 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedAssess.lecturers.map((l, i) => (
                          <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-accent/20">
                            <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{l.code}</td>
                            <td className="px-4 py-2 font-medium text-foreground">{l.course}</td>
                            <td className="px-4 py-2 text-muted-foreground">{l.name}</td>
                            <td className="px-4 py-2">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${/assessed/i.test(l.status) ? "bg-[color:var(--success)]/10 text-[color:var(--success)]" : "bg-[color:var(--warning)]/10 text-[color:var(--warning)]"}`}>{l.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <pre className="whitespace-pre-wrap rounded-xl border border-border bg-accent/20 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">{snap.text}</pre>
              )}
            </>
          )}

          {/* Industrial Liaison / Attachment */}
          {parsedLiaison && (
            <>
              <div className="mb-4 rounded-xl border border-border bg-primary/5 px-5 py-4">
                <p className="text-base font-bold text-foreground">{parsedLiaison.name || "Student"}</p>
                {parsedLiaison.indexNumber && <p className="font-mono text-xs text-muted-foreground mt-0.5">{parsedLiaison.indexNumber}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
                {[["Company", parsedLiaison.company], ["Supervisor", parsedLiaison.supervisor], ["Start Date", parsedLiaison.startDate], ["End Date", parsedLiaison.endDate]].filter(([, v]) => v).map(([l, v]) => (
                  <div key={l as string} className="rounded-lg border border-border bg-accent/20 px-3 py-2.5">
                    <p className="text-[10px] text-muted-foreground">{l}</p>
                    <p className="mt-0.5 text-xs font-semibold text-foreground">{v}</p>
                  </div>
                ))}
              </div>
              {parsedLiaison.items.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Details</div>
                  {parsedLiaison.items.map((item, i) => (
                    <div key={i} className="flex items-start justify-between border-t border-border/50 px-4 py-2.5 text-xs hover:bg-accent/20 gap-4">
                      <span className="shrink-0 text-muted-foreground">{item.label}</span>
                      <span className="text-right font-medium text-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {!parsedLiaison.company && parsedLiaison.items.length === 0 && (
                <pre className="whitespace-pre-wrap rounded-xl border border-border bg-accent/20 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">{snap.text}</pre>
              )}
            </>
          )}

          {/* Generic portal page */}
          {parsedGeneric && (
            <>
              {(parsedGeneric.name || parsedGeneric.indexNumber) && (
                <div className="mb-4 rounded-xl border border-border bg-primary/5 px-5 py-3">
                  {parsedGeneric.name && <p className="text-sm font-bold text-foreground">{parsedGeneric.name}</p>}
                  {parsedGeneric.indexNumber && <p className="font-mono text-xs text-muted-foreground">{parsedGeneric.indexNumber}</p>}
                </div>
              )}
              {parsedGeneric.items.length > 0 ? (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{parsedGeneric.title}</div>
                  {parsedGeneric.items.map((item, i) => (
                    <div key={i} className="flex items-start justify-between border-t border-border/50 px-4 py-2.5 text-xs hover:bg-accent/20 gap-4">
                      <span className="shrink-0 text-muted-foreground">{item.label}</span>
                      <span className="text-right font-medium text-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap rounded-xl border border-border bg-accent/20 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">{snap.text}</pre>
              )}
            </>
          )}

        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SavedPage() {
  const { user } = useAuth();
  const [data, setData] = useState<{ sessionCount: number; sessions: PortalSession[]; recentEvents: PortalEvent[] } | null>(null);
  const [gatewayError, setGatewayError] = useState(false);
  const [dbSnapshots, setDbSnapshots] = useState<PortalSnapshotRow[]>([]);
  const [dbChanges, setDbChanges] = useState<PortalChangeRow[]>([]);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"sessions" | "snapshots" | "changes">("sessions");
  const [expandedChange, setExpandedChange] = useState<Set<string>>(new Set());
  const [viewSnap, setViewSnap] = useState<PortalSnapshotRow | null>(null);
  const tickRef = useRef(0);
  const syncedChangeIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([loadPortalSnapshots(user.id), loadPortalChanges(user.id)]).then(([snaps, changes]) => {
      setDbSnapshots(snaps); setDbChanges(changes); setDbLoaded(true);
    });
  }, [user?.id]);

  const syncSnapshots = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetchPortalSnapshots();
      if (!res.ok) return;
      if (res.snapshots.length > 0 || res.changes.length > 0) {
        await syncToSupabase(user.id, res.snapshots, res.changes, syncedChangeIds.current);
        const [snaps, changes] = await Promise.all([loadPortalSnapshots(user.id), loadPortalChanges(user.id)]);
        setDbSnapshots(snaps); setDbChanges(changes);
        const newChanges = res.changes.filter(c => !syncedChangeIds.current.has(c.id + "_notified"));
        newChanges.forEach(c => { toast.warning(`Content changed: ${c.contentType}`, { description: `${c.path} was different from your last visit.` }); syncedChangeIds.current.add(c.id + "_notified"); });
      }
    } catch { /* gateway may not be running */ }
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      try { const res = await fetchPortalSessions(); setGatewayError(false); setData(res); } catch { setGatewayError(true); }
      await syncSnapshots();
      if (!cancelled) tickRef.current = window.setTimeout(poll, 2000);
    }
    poll();
    return () => { cancelled = true; clearTimeout(tickRef.current); };
  }, [syncSnapshots]);

  async function handleClear() {
    try { await clearPortalSessions(); setData(null); toast.success("Session data cleared"); } catch { toast.error("Failed to clear sessions"); }
  }
  function toggleExpand(id: string) { setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleChange(id: string) { setExpandedChange(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  const sessions = data?.sessions ?? [];
  const recentEvents = data?.recentEvents ?? [];
  const filteredSessions = sessions.filter(s => s.ip.includes(q) || s.id.includes(q) || s.pageTrail.some(p => p.path.toLowerCase().includes(q.toLowerCase())));
  const HIDDEN_TYPES = new Set(["Industrial Liaison", "Lecturer Portal", "Attachment Letter", "Assumption Form"]);

  const filteredSnapshots = (() => {
    const all = dbSnapshots.filter(s =>
      !HIDDEN_TYPES.has(s.content_type) &&
      (s.content_type.toLowerCase().includes(q.toLowerCase()) ||
       s.path.toLowerCase().includes(q.toLowerCase()))
    );
    // For daily-only pages, keep only the most recent snapshot per calendar day
    const dailyOnly = new Set(["Student Dashboard", "Student Home"]);
    const seen = new Set<string>();
    const deduped: typeof all = [];
    for (const s of all) {
      if (dailyOnly.has(s.content_type)) {
        const day = new Date(s.captured_at).toLocaleDateString("en-CA");
        const key = `${s.content_type}:${day}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      deduped.push(s);
    }
    return deduped;
  })();
  const filteredChanges = dbChanges.filter(c => c.content_type.toLowerCase().includes(q.toLowerCase()) || c.path.toLowerCase().includes(q.toLowerCase()));
  const activeNow = sessions.filter(s => Date.now() - s.lastSeen < 30000).length;
  const avgLatency = recentEvents.length > 0 ? Math.round(recentEvents.reduce((s, e) => s + e.latencyMs, 0) / recentEvents.length) : 0;

  return (
    <AppLayout title="Portal Sessions">
      <SnapshotModal snap={viewSnap} onClose={() => setViewSnap(null)} />

      {gatewayError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <WifiOff className="h-4 w-4 shrink-0" />
          Cannot reach gateway. Showing saved history from your account.
        </div>
      )}

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Sessions" value={data?.sessionCount ?? 0} icon={<Users className="h-4 w-4" />} tone="primary" hint="Unique portal visitors" />
        <StatCard label="Active Now" value={activeNow} icon={<Activity className="h-4 w-4" />} tone="success" hint="Active in last 30s" />
        <StatCard label="Snapshots Saved" value={dbSnapshots.length} icon={<History className="h-4 w-4" />} tone="warning" hint="Pages captured in your account" />
        <StatCard label="Changes Detected" value={dbChanges.length} icon={<AlertTriangle className="h-4 w-4" />} tone={dbChanges.length > 0 ? "warning" : "primary"} hint="Content differences found" />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {([
          { key: "sessions", label: "Live Sessions", icon: <Activity className="h-3.5 w-3.5" /> },
          { key: "snapshots", label: "Saved History", icon: <History className="h-3.5 w-3.5" />, badge: dbSnapshots.length },
          { key: "changes", label: "Changes", icon: <AlertTriangle className="h-3.5 w-3.5" />, badge: dbChanges.length, alert: dbChanges.length > 0 },
        ] as const).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${activeTab === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
            {tab.icon}{tab.label}
            {"badge" in tab && tab.badge > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${"alert" in tab && tab.alert ? "bg-destructive/20 text-destructive" : "bg-primary/10 text-primary"} ${activeTab === tab.key ? "bg-white/20 text-white" : ""}`}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4 relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search sessions, pages, content..." className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {/* ── Live Sessions tab ── */}
      {activeTab === "sessions" && (
        <>
          <SectionCard
            title="Student Portal Sessions"
            description="Every student who accessed the TTU portal through LoadShield's embedded viewer — click a row to see their page trail."
            action={sessions.length > 0 ? (
              <button onClick={handleClear} className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent">
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            ) : undefined}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="w-6 px-3 py-3" />
                    <th className="px-3 py-3 font-medium">Session</th>
                    <th className="px-3 py-3 font-medium">IP Address</th>
                    <th className="px-3 py-3 font-medium">First Seen</th>
                    <th className="px-3 py-3 font-medium">Last Seen</th>
                    <th className="px-3 py-3 font-medium">Pages</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.length === 0 && (
                    <tr><td colSpan={7} className="py-16 text-center text-sm text-muted-foreground">{sessions.length === 0 ? "No portal sessions yet. Open the Portal Viewer and visit the embedded TTU portal." : "No sessions match your search."}</td></tr>
                  )}
                  {filteredSessions.map((session, i) => {
                    const isOpen = expanded.has(session.id);
                    const isActive = Date.now() - session.lastSeen < 30000;
                    return (
                      <>
                        <motion.tr key={session.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} onClick={() => toggleExpand(session.id)} className="cursor-pointer border-b border-border/60 hover:bg-accent/40 last:border-0">
                          <td className="px-3 py-3"><ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} /></td>
                          <td className="px-3 py-3"><div className="flex items-center gap-2"><div className={`h-2 w-2 rounded-full ${isActive ? "animate-pulse bg-[color:var(--success)]" : "bg-muted-foreground/40"}`} /><span className="font-mono text-xs text-foreground">{session.id}</span></div></td>
                          <td className="px-3 py-3"><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Globe className="h-3.5 w-3.5" />{session.ip}</span></td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{formatTime(session.firstSeen)}</td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{timeAgo(session.lastSeen)}</td>
                          <td className="px-3 py-3"><span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><MapPin className="h-3 w-3" />{session.pageTrail.length}</span></td>
                          <td className="px-3 py-3"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${isActive ? "bg-[color:var(--success)]/10 text-[color:var(--success)]" : "bg-muted text-muted-foreground"}`}>{isActive ? "Active" : "Inactive"}</span></td>
                        </motion.tr>
                        <AnimatePresence>
                          {isOpen && (
                            <motion.tr key={`${session.id}-trail`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                              <td colSpan={7} className="bg-accent/30 px-6 pb-4 pt-2">
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Page Trail — {session.requestCount} total requests</p>
                                {session.pageTrail.length === 0 ? <p className="text-xs text-muted-foreground">No page navigations recorded yet.</p> : (
                                  <div className="flex flex-wrap items-center gap-1">
                                    {session.pageTrail.map((p, idx) => (
                                      <div key={idx} className="flex items-center gap-1">
                                        <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                                          <p className="font-medium text-foreground">{pageName(p.path)}</p>
                                          <p className="text-[10px] text-muted-foreground">{formatTime(p.time)} · {p.latencyMs}ms · <span className={statusColor(p.status)}>{p.status}</span></p>
                                        </div>
                                        {idx < session.pageTrail.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </motion.tr>
                          )}
                        </AnimatePresence>
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard className="mt-6" title="Live Activity Feed" description="Every portal request in real time — updates every 2 seconds.">
            {recentEvents.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">No activity yet. Visit the Portal Viewer to start tracking.</div>
            ) : (
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {recentEvents.slice(0, 50).map((event, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.01 }} className="flex items-center gap-3 rounded-lg border border-border/50 bg-background px-3 py-2">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${event.method === "POST" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{event.method}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{event.path || "/"}</span>
                    <span className={`shrink-0 text-xs font-semibold ${statusColor(event.status)}`}>{event.status}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{event.latencyMs}ms</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(event.time)}</span>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"><Shield className="h-3 w-3" />{event.sessionId}</span>
                  </motion.div>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* ── Saved History tab ── */}
      {activeTab === "snapshots" && (
        <SectionCard
          title="Saved Content History"
          description="Every watchable page you've visited through the portal viewer — stored permanently in your account."
          action={filteredSnapshots.length > 0 ? (
            <button onClick={() => downloadSnapshots(filteredSnapshots, user?.name)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              <Download className="h-3.5 w-3.5" /> Download Report
            </button>
          ) : undefined}
        >
          {!dbLoaded ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> Loading your history…
            </div>
          ) : filteredSnapshots.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <History className="h-8 w-8 opacity-30" />
              <p>No snapshots yet.</p>
              <p className="text-xs">Visit your results or fees page in the Portal Viewer to capture a snapshot.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
              {filteredSnapshots.map((snap, i) => (
                <motion.div key={snap.id ?? i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="h-full">
                  <SnapshotCard snap={snap} onView={() => setViewSnap(snap)} />
                </motion.div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Changes tab ── */}
      {activeTab === "changes" && (
        <SectionCard title="Content Changes Detected" description="Pages where content was different between visits — use these as evidence if something looks wrong.">
          {!dbLoaded ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> Loading your change history…
            </div>
          ) : filteredChanges.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-8 w-8 opacity-30" />
              <p>No changes detected yet.</p>
              <p className="text-xs">Changes are recorded automatically when your results or fees differ from a previous visit.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredChanges.map((change, i) => {
                const isOpen = expandedChange.has(change.id ?? String(i));
                return (
                  <motion.div key={change.id ?? i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/5">
                    <button onClick={() => toggleChange(change.id ?? String(i))} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-[color:var(--warning)]" />
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <ContentIcon label={change.content_type} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-semibold text-foreground">{change.content_type}</span>
                        <span className="font-mono text-xs text-muted-foreground">{change.path}</span>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-medium text-[color:var(--warning)]">Change detected</p>
                        <p className="text-[11px] text-muted-foreground">{formatDate(change.detected_at)}</p>
                      </div>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    <AnimatePresence>
                      {isOpen && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-t border-[color:var(--warning)]/20">
                          <div className="grid gap-px sm:grid-cols-2">
                            <div className="bg-destructive/5 p-4">
                              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-destructive">
                                <span className="h-2 w-2 rounded-full bg-destructive" /> Before — {formatDate(change.before_captured_at)}
                              </p>
                              <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">{truncate(change.before_text, 600)}</p>
                            </div>
                            <div className="bg-[color:var(--success)]/5 p-4">
                              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--success)]">
                                <span className="h-2 w-2 rounded-full bg-[color:var(--success)]" /> After — {formatDate(change.after_captured_at)}
                              </p>
                              <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">{truncate(change.after_text, 600)}</p>
                            </div>
                          </div>
                          <div className="px-4 py-2 text-[11px] text-muted-foreground">Session: <span className="font-mono">{change.session_id}</span></div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}
    </AppLayout>
  );
}
