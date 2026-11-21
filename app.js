const STORAGE_KEY = "studyhub_escolar_v1";
const SUPABASE_URL = "https://nmetrjlkxfgikemrllqf.supabase.co";
const SUPABASE_KEY = "sb_publishable_92sIx3OWVxqRSgffKbsGDA_TOC5Owb-";
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

let currentUser = null;
let cloudSyncTimer = null;

const DEFAULT_DATA = {
  theme: "light",
  pomodoroCount: 0,
  subjects: [
    {
      id: "sub-math",
      name: "Matemáticas",
      teacher: "Prof. Ramírez",
      color: "#6366f1",
      grades: [
        { id: "g1", type: "Examen", label: "Parcial 1", score: 9.2, weight: 50 },
        { id: "g2", type: "Actividades", label: "Ejercicios", score: 9.8, weight: 30 },
        { id: "g2b", type: "Proyecto", label: "Modelado", score: 9.5, weight: 20 },
      ],
    },
    {
      id: "sub-hist",
      name: "Historia",
      teacher: "Profa. López",
      color: "#f59e0b",
      grades: [
        { id: "g3", type: "Proyecto", label: "Ensayo", score: 8.7, weight: 40 },
        { id: "g3b", type: "Examen", label: "Parcial 1", score: 9.0, weight: 60 },
      ],
    },
    {
      id: "sub-bio",
      name: "Biología",
      teacher: "Prof. Mendoza",
      color: "#10b981",
      grades: [{ id: "g4", type: "Laboratorio", label: "Práctica 1", score: 9.5, weight: 30 }],
    },
  ],
  tasks: [
    {
      id: "t1",
      title: "Resolver guía de derivadas",
      subjectId: "sub-math",
      type: "Tarea",
      dueDate: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
      priority: "alta",
      done: false,
    },
    {
      id: "t2",
      title: "Leer capítulo 4: Revolución Industrial",
      subjectId: "sub-hist",
      type: "Lectura",
      dueDate: new Date(Date.now() + 86400000 * 4).toISOString().slice(0, 10),
      priority: "media",
      done: false,
    },
  ],
  schedule: [
    { id: "c1", subjectId: "sub-math", day: "Lunes", start: "08:00", end: "09:30", room: "Aula 102" },
    { id: "c2", subjectId: "sub-hist", day: "Martes", start: "10:00", end: "11:30", room: "Aula 205" },
    { id: "c3", subjectId: "sub-bio", day: "Miércoles", start: "09:00", end: "10:30", room: "Lab. 1" },
  ],
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_DATA);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_DATA),
      ...parsed,
      schedule: Array.isArray(parsed.schedule) ? parsed.schedule : structuredClone(DEFAULT_DATA.schedule),
    };
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (currentUser && supabaseClient) {
    scheduleCloudSync();
  }
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// --- Fecha de hoy en encabezado ---
const todayLabel = document.getElementById("today-label");
if (todayLabel) {
  const formattedDate = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  todayLabel.textContent = `Hoy es ${formattedDate}`;
}

function formatDueBadge(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const diffDays = Math.round((due - today) / 86400000);

  if (diffDays < 0) return { text: "Vencida", cls: "tag-urgent" };
  if (diffDays === 0) return { text: "Para hoy", cls: "tag-urgent" };
  if (diffDays === 1) return { text: "Mañana", cls: "tag-soon" };
  if (diffDays <= 7) return { text: `En ${diffDays} días`, cls: "" };
  return { text: dateStr, cls: "" };
}

// --- Tema ---
const themeBtn = document.getElementById("theme-toggle");
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  themeBtn.textContent = state.theme === "dark" ? "☀️" : "🌙";
}
themeBtn.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveState();
  applyTheme();
});

// --- Navegación lateral (Sidebar) ---
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
if (sidebarToggle && sidebar) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
  });
}

function switchTab(tabName) {
  document.querySelectorAll(".nav-item[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `tab-${tabName}`);
  });
}

document.querySelectorAll(".nav-item[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

const dashGoTasks = document.getElementById("dash-go-tasks");
if (dashGoTasks) {
  dashGoTasks.addEventListener("click", () => switchTab("tasks"));
}

// --- Cálculos de promedio ---
function getSubjectWeightSum(subject) {
  return subject.grades.reduce((acc, g) => acc + (Number(g.weight) || 0), 0);
}

function getSubjectAverage(subject) {
  if (!subject.grades.length) return null;
  const totalWeight = getSubjectWeightSum(subject);
  if (totalWeight > 0) {
    const weightedSum = subject.grades.reduce(
      (acc, g) => acc + Number(g.score) * (Number(g.weight) || 0),
      0
    );
    return weightedSum / totalWeight;
  }
  const sum = subject.grades.reduce((acc, g) => acc + Number(g.score), 0);
  return sum / subject.grades.length;
}

function getOverallAverage() {
  const avgs = state.subjects.map(getSubjectAverage).filter((v) => v !== null);
  if (!avgs.length) return null;
  return avgs.reduce((a, b) => a + b, 0) / avgs.length;
}

// --- Renderizado ---
function renderSubjectSelects() {
  const taskSub = document.getElementById("task-subject");
  const filterSub = document.getElementById("filter-subject");
  const gradeSub = document.getElementById("grade-subject");
  const scheduleSub = document.getElementById("schedule-subject");

  const prevFilter = filterSub.value;

  taskSub.innerHTML = "";
  gradeSub.innerHTML = "";
  scheduleSub.innerHTML = "";
  filterSub.innerHTML = '<option value="all">Todas las materias</option>';

  if (!state.subjects.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Sin materias (agrega una primero)";
    taskSub.appendChild(opt.cloneNode(true));
    gradeSub.appendChild(opt.cloneNode(true));
    scheduleSub.appendChild(opt);
    return;
  }

  state.subjects.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    taskSub.appendChild(opt.cloneNode(true));
    gradeSub.appendChild(opt.cloneNode(true));
    scheduleSub.appendChild(opt.cloneNode(true));
    filterSub.appendChild(opt);
  });

  if ([...filterSub.options].some((o) => o.value === prevFilter)) {
    filterSub.value = prevFilter;
  }
}

function renderTasks() {
  const list = document.getElementById("task-list");
  const empty = document.getElementById("task-empty");
  const statusFilter = document.getElementById("filter-status").value;
  const subjectFilter = document.getElementById("filter-subject").value;

  const filtered = state.tasks.filter((t) => {
    if (statusFilter === "pending" && t.done) return false;
    if (statusFilter === "done" && !t.done) return false;
    if (subjectFilter !== "all" && t.subjectId !== subjectFilter) return false;
    return true;
  });

  list.innerHTML = "";
  empty.classList.toggle("hidden", filtered.length > 0);

  filtered.forEach((task) => {
    const subject = state.subjects.find((s) => s.id === task.subjectId);
    const li = document.createElement("li");
    li.className = `task-item ${task.done ? "done" : ""}`;

    const left = document.createElement("div");
    left.className = "task-left";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      saveState();
      renderAll();
    });

    const info = document.createElement("div");
    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-meta";

    if (subject) {
      const subTag = document.createElement("span");
      subTag.className = "tag";
      subTag.innerHTML = `<span class="dot" style="background:${subject.color}"></span>`;
      subTag.appendChild(document.createTextNode(subject.name));
      meta.appendChild(subTag);
    }

    const typeTag = document.createElement("span");
    typeTag.className = "tag";
    typeTag.textContent = task.type;
    meta.appendChild(typeTag);

    const dueInfo = formatDueBadge(task.dueDate);
    if (dueInfo) {
      const dateTag = document.createElement("span");
      dateTag.className = `tag ${dueInfo.cls}`.trim();
      dateTag.textContent = `📅 ${dueInfo.text}`;
      meta.appendChild(dateTag);
    }

    const prioTag = document.createElement("span");
    prioTag.className = `tag priority-${task.priority}`;
    prioTag.textContent = `Prioridad ${task.priority}`;
    meta.appendChild(prioTag);

    info.appendChild(title);
    info.appendChild(meta);
    left.appendChild(checkbox);
    left.appendChild(info);

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.title = "Eliminar actividad";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      saveState();
      renderAll();
    });

    li.appendChild(left);
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

function renderSubjects() {
  const grid = document.getElementById("subject-list");
  const empty = document.getElementById("subject-empty");
  grid.innerHTML = "";
  empty.classList.toggle("hidden", state.subjects.length > 0);

  state.subjects.forEach((sub) => {
    const card = document.createElement("div");
    card.className = "subject-card";
    card.style.borderTopColor = sub.color;

    const top = document.createElement("div");
    top.className = "subject-top";

    const titleBox = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "subject-name";
    nameEl.textContent = sub.name;
    titleBox.appendChild(nameEl);

    if (sub.teacher) {
      const teacherEl = document.createElement("div");
      teacherEl.className = "subject-teacher";
      teacherEl.textContent = sub.teacher;
      titleBox.appendChild(teacherEl);
    }

    const delSubBtn = document.createElement("button");
    delSubBtn.className = "icon-btn";
    delSubBtn.title = "Eliminar materia";
    delSubBtn.textContent = "✕";
    delSubBtn.addEventListener("click", () => {
      state.subjects = state.subjects.filter((s) => s.id !== sub.id);
      saveState();
      renderAll();
    });

    top.appendChild(titleBox);
    top.appendChild(delSubBtn);

    const avg = getSubjectAverage(sub);
    const totalWeight = getSubjectWeightSum(sub);
    const metaRow = document.createElement("div");
    metaRow.className = "subject-meta-row";

    const avgEl = document.createElement("div");
    avgEl.className = "subject-avg";
    avgEl.textContent = `Promedio: ${avg !== null ? avg.toFixed(2) : "Sin notas"}`;

    const weightPill = document.createElement("span");
    weightPill.className = `weight-pill ${totalWeight > 100 ? "over" : ""}`.trim();
    weightPill.textContent = `${totalWeight}% / 100%`;

    metaRow.appendChild(avgEl);
    metaRow.appendChild(weightPill);

    const chips = document.createElement("div");
    chips.className = "grade-chips";
    sub.grades.forEach((g) => {
      const chip = document.createElement("span");
      chip.className = "grade-chip";
      const typePrefix = g.type ? `${g.type} · ` : "";
      const weightSuffix = g.weight ? ` (${g.weight}%)` : "";
      chip.textContent = `${typePrefix}${g.label}: ${Number(g.score).toFixed(1)}${weightSuffix}`;
      const rm = document.createElement("button");
      rm.title = "Eliminar calificación";
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        sub.grades = sub.grades.filter((item) => item.id !== g.id);
        saveState();
        renderAll();
      });
      chip.appendChild(rm);
      chips.appendChild(chip);
    });

    card.appendChild(top);
    card.appendChild(metaRow);
    card.appendChild(chips);
    grid.appendChild(card);
  });
}

function setGauge(elId, pct) {
  const el = document.getElementById(elId);
  if (!el) return;
  const r = 46;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  el.style.strokeDasharray = `${circ}`;
  el.style.strokeDashoffset = `${circ * (1 - clamped / 100)}`;
}

function renderStats() {
  const totalTasks = state.tasks.length;
  const doneTasks = state.tasks.filter((t) => t.done).length;
  const pending = totalTasks - doneTasks;
  document.getElementById("stat-pending").textContent = pending;

  const overall = getOverallAverage();
  const formatted = overall !== null ? overall.toFixed(2) : "—";
  document.getElementById("stat-average").textContent = formatted;
  document.getElementById("overall-gpa-badge").textContent = `Promedio: ${formatted}`;
  document.getElementById("pomodoro-count").textContent = state.pomodoroCount;
  const statPomodoros = document.getElementById("stat-pomodoros");
  if (statPomodoros) statPomodoros.textContent = state.pomodoroCount;

  // Dashboard gauges
  const taskPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 100;
  setGauge("gauge-tasks", taskPct);
  const gTasksVal = document.getElementById("gauge-tasks-val");
  const gTasksSub = document.getElementById("gauge-tasks-sub");
  if (gTasksVal) gTasksVal.textContent = `${taskPct}%`;
  if (gTasksSub) gTasksSub.textContent = `${doneTasks} / ${totalTasks} listas`;

  const avgPct = overall !== null ? (overall / 10) * 100 : 0;
  setGauge("gauge-avg", avgPct);
  const gAvgVal = document.getElementById("gauge-avg-val");
  if (gAvgVal) gAvgVal.textContent = formatted;

  const focusPct = Math.min(100, (state.pomodoroCount / 4) * 100);
  setGauge("gauge-focus", focusPct);
  const gFocusVal = document.getElementById("gauge-focus-val");
  if (gFocusVal) gFocusVal.textContent = state.pomodoroCount;

  const subPct = Math.min(100, (state.subjects.length / 8) * 100);
  setGauge("gauge-subjects", subPct);
  const gSubVal = document.getElementById("gauge-subjects-val");
  if (gSubVal) gSubVal.textContent = state.subjects.length;

  // Overview & Usage stats
  const ovPending = document.getElementById("ov-pending");
  if (ovPending) ovPending.textContent = `${pending} pendientes`;

  const nextTask = state.tasks
    .filter((t) => !t.done && t.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const ovNext = document.getElementById("ov-next-task");
  if (ovNext) ovNext.textContent = nextTask ? `${nextTask.title} (${nextTask.dueDate})` : "Sin fechas próximas";

  const bestSub = state.subjects
    .map((s) => ({ name: s.name, avg: getSubjectAverage(s) }))
    .filter((s) => s.avg !== null)
    .sort((a, b) => b.avg - a.avg)[0];
  const ovBest = document.getElementById("ov-best-subject");
  if (ovBest) ovBest.textContent = bestSub ? `${bestSub.name} (${bestSub.avg.toFixed(2)})` : "—";

  const ovClasses = document.getElementById("ov-classes");
  if (ovClasses) ovClasses.textContent = `${state.schedule.length} clases`;

  const usageDone = document.getElementById("usage-done");
  const usageSubs = document.getElementById("usage-subjects");
  const usageClasses = document.getElementById("usage-classes");
  if (usageDone) usageDone.textContent = doneTasks;
  if (usageSubs) usageSubs.textContent = state.subjects.length;
  if (usageClasses) usageClasses.textContent = state.schedule.length;
}

const DAYS_ORDER = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function renderSchedule() {
  const grid = document.getElementById("schedule-grid");
  const empty = document.getElementById("schedule-empty");
  grid.innerHTML = "";
  empty.classList.toggle("hidden", state.schedule.length > 0);
  if (!state.schedule.length) return;

  DAYS_ORDER.forEach((day) => {
    const slots = state.schedule
      .filter((c) => c.day === day)
      .sort((a, b) => a.start.localeCompare(b.start));

    if (!slots.length) return;

    const col = document.createElement("div");
    col.className = "day-column";

    const heading = document.createElement("h3");
    heading.className = "day-title";
    heading.textContent = day;
    col.appendChild(heading);

    slots.forEach((slot) => {
      const subject = state.subjects.find((s) => s.id === slot.subjectId);
      const item = document.createElement("div");
      item.className = "class-slot";
      item.style.borderLeftColor = subject ? subject.color : "var(--primary)";

      const info = document.createElement("div");
      const timeEl = document.createElement("div");
      timeEl.className = "class-time";
      timeEl.textContent = `${slot.start} - ${slot.end}`;

      const nameEl = document.createElement("div");
      nameEl.className = "class-name";
      nameEl.textContent = subject ? subject.name : "Materia eliminada";

      info.appendChild(timeEl);
      info.appendChild(nameEl);

      if (slot.room) {
        const roomEl = document.createElement("div");
        roomEl.className = "class-room";
        roomEl.textContent = slot.room;
        info.appendChild(roomEl);
      }

      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn";
      delBtn.title = "Quitar clase";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", () => {
        state.schedule = state.schedule.filter((c) => c.id !== slot.id);
        saveState();
        renderSchedule();
      });

      item.appendChild(info);
      item.appendChild(delBtn);
      col.appendChild(item);
    });

    grid.appendChild(col);
  });
}

function updateWeightHint() {
  const hint = document.getElementById("weight-hint");
  const subId = document.getElementById("grade-subject").value;
  const subject = state.subjects.find((s) => s.id === subId);
  if (!hint) return;
  if (!subject) {
    hint.textContent = "Agrega una materia primero.";
    hint.classList.remove("over");
    return;
  }
  const sum = getSubjectWeightSum(subject);
  hint.textContent = `Porcentaje asignado en ${subject.name}: ${sum}%` + (sum > 100 ? " (pasa de 100%)" : "");
  hint.classList.toggle("over", sum > 100);
}

function renderAll() {
  applyTheme();
  renderSubjectSelects();
  renderTasks();
  renderSubjects();
  renderSchedule();
  renderStats();
  updateWeightHint();
}

// --- Formularios ---
document.getElementById("task-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = document.getElementById("task-title").value.trim();
  if (!title) return;

  state.tasks.unshift({
    id: uid("task"),
    title,
    subjectId: document.getElementById("task-subject").value,
    type: document.getElementById("task-type").value,
    dueDate: document.getElementById("task-date").value,
    priority: document.getElementById("task-priority").value,
    done: false,
  });

  e.target.reset();
  saveState();
  renderAll();
});

document.getElementById("filter-status").addEventListener("change", renderTasks);
document.getElementById("filter-subject").addEventListener("change", renderTasks);

document.getElementById("subject-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("subject-name").value.trim();
  if (!name) return;

  state.subjects.push({
    id: uid("sub"),
    name,
    teacher: document.getElementById("subject-teacher").value.trim(),
    color: document.getElementById("subject-color").value,
    grades: [],
  });

  e.target.reset();
  document.getElementById("subject-color").value = "#6366f1";
  saveState();
  renderAll();
});

const gradeTypeSelect = document.getElementById("grade-type");
const customTypeWrap = document.getElementById("grade-custom-type-wrap");
const customTypeInput = document.getElementById("grade-custom-type");

gradeTypeSelect.addEventListener("change", () => {
  const isCustom = gradeTypeSelect.value === "Otro";
  customTypeWrap.classList.toggle("hidden", !isCustom);
  customTypeInput.required = isCustom;
});

document.getElementById("grade-subject").addEventListener("change", updateWeightHint);

document.getElementById("grade-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const subId = document.getElementById("grade-subject").value;
  const subject = state.subjects.find((s) => s.id === subId);
  if (!subject) return;

  const selectedType = gradeTypeSelect.value;
  const type = selectedType === "Otro" ? customTypeInput.value.trim() || "Otro" : selectedType;
  const label = document.getElementById("grade-label").value.trim();
  const score = parseFloat(document.getElementById("grade-score").value);
  const weight = parseFloat(document.getElementById("grade-weight").value);
  if (!label || Number.isNaN(score) || Number.isNaN(weight)) return;

  subject.grades.push({ id: uid("g"), type, label, score, weight });
  e.target.reset();
  customTypeWrap.classList.add("hidden");
  customTypeInput.required = false;
  saveState();
  renderAll();
});

document.getElementById("schedule-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const subjectId = document.getElementById("schedule-subject").value;
  if (!subjectId) return;

  state.schedule.push({
    id: uid("cls"),
    subjectId,
    day: document.getElementById("schedule-day").value,
    start: document.getElementById("schedule-start").value,
    end: document.getElementById("schedule-end").value,
    room: document.getElementById("schedule-room").value.trim(),
  });

  e.target.reset();
  document.getElementById("schedule-start").value = "08:00";
  document.getElementById("schedule-end").value = "09:00";
  saveState();
  renderSchedule();
});

document.getElementById("export-data").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `studyhub-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-data").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (parsed && Array.isArray(parsed.subjects) && Array.isArray(parsed.tasks)) {
        state = { ...structuredClone(DEFAULT_DATA), ...parsed };
        saveState();
        renderAll();
      }
    } catch {
      alert("El archivo de respaldo no es válido.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById("reset-demo").addEventListener("click", () => {
  state = structuredClone(DEFAULT_DATA);
  saveState();
  renderAll();
});

// --- Temporizador Pomodoro ---
let currentMinutes = 25;
let secondsLeft = 25 * 60;
let timerInterval = null;
let currentMode = "focus";

const timerDisplay = document.getElementById("timer-display");
const timerRing = document.getElementById("timer-ring-progress");
const RING_CIRCUMFERENCE = 2 * Math.PI * 80;
const startBtn = document.getElementById("timer-start");
const pauseBtn = document.getElementById("timer-pause");
const resetBtn = document.getElementById("timer-reset");

function formatTime(totalSec) {
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function updateTimerUI() {
  timerDisplay.textContent = formatTime(secondsLeft);
  if (timerRing) {
    const total = currentMinutes * 60;
    const progress = total > 0 ? (total - secondsLeft) / total : 0;
    timerRing.style.strokeDashoffset = String(RING_CIRCUMFERENCE * progress);
  }
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio no disponible
  }
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  startBtn.disabled = false;
  pauseBtn.disabled = true;
}

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    stopTimer();
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMinutes = Number(btn.dataset.minutes);
    currentMode = btn.dataset.mode;
    secondsLeft = currentMinutes * 60;
    updateTimerUI();
  });
});

startBtn.addEventListener("click", () => {
  if (timerInterval) return;
  startBtn.disabled = true;
  pauseBtn.disabled = false;

  timerInterval = setInterval(() => {
    secondsLeft -= 1;
    updateTimerUI();
    if (secondsLeft <= 0) {
      stopTimer();
      playChime();
      if (currentMode === "focus") {
        state.pomodoroCount += 1;
        saveState();
        renderStats();
      }
      secondsLeft = currentMinutes * 60;
      updateTimerUI();
    }
  }, 1000);
});

pauseBtn.addEventListener("click", stopTimer);

resetBtn.addEventListener("click", () => {
  stopTimer();
  secondsLeft = currentMinutes * 60;
  updateTimerUI();
});

renderAll();
updateTimerUI();

// --- Sincronización y Auth con Supabase ---
const authModal = document.getElementById("auth-modal");
const authOpenBtn = document.getElementById("auth-open-btn");
const authBtnLabel = document.getElementById("auth-btn-label");
const authCloseBtn = document.getElementById("auth-close-btn");
const authLoggedOut = document.getElementById("auth-logged-out");
const authLoggedIn = document.getElementById("auth-logged-in");
const authUserEmail = document.getElementById("auth-user-email");
const authMessage = document.getElementById("auth-message");
const authForm = document.getElementById("auth-form");
const authSignupBtn = document.getElementById("auth-signup-btn");
const authSignoutBtn = document.getElementById("auth-signout-btn");
const syncNowBtn = document.getElementById("sync-now-btn");

function showAuthMsg(text, type = "") {
  authMessage.textContent = text;
  authMessage.className = `auth-message ${type}`.trim();
}

function clearAuthMsg() {
  authMessage.textContent = "";
  authMessage.className = "auth-message hidden";
}

function updateAuthUI() {
  const syncPill = document.getElementById("sync-status-pill");
  const ovCloud = document.getElementById("ov-cloud");
  if (currentUser) {
    authOpenBtn.classList.add("connected");
    authBtnLabel.textContent = currentUser.email.split("@")[0];
    if (syncPill) {
      syncPill.textContent = `☁️ ${currentUser.email}`;
      syncPill.classList.add("connected");
    }
    if (ovCloud) ovCloud.textContent = `Nube (${currentUser.email})`;
    authLoggedOut.classList.add("hidden");
    authLoggedIn.classList.remove("hidden");
    authUserEmail.textContent = currentUser.email;
  } else {
    authOpenBtn.classList.remove("connected");
    authBtnLabel.textContent = "Conectar nube";
    if (syncPill) {
      syncPill.textContent = "Modo local";
      syncPill.classList.remove("connected");
    }
    if (ovCloud) ovCloud.textContent = "Local (navegador)";
    authLoggedOut.classList.remove("hidden");
    authLoggedIn.classList.add("hidden");
    authUserEmail.textContent = "";
  }
}

async function saveCloudWorkspace() {
  if (!currentUser || !supabaseClient) return;
  authBtnLabel.textContent = "Guardando...";
  const { error } = await supabaseClient.from("studyhub_workspaces").upsert(
    {
      user_id: currentUser.id,
      data: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) {
    authBtnLabel.textContent = "Error nube";
  } else {
    authBtnLabel.textContent = `${currentUser.email.split("@")[0]} ✓`;
  }
}

function scheduleCloudSync() {
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(saveCloudWorkspace, 700);
}

async function loadCloudWorkspace() {
  if (!currentUser || !supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("studyhub_workspaces")
    .select("data")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    showAuthMsg(`No se pudo leer la nube: ${error.message}`, "error");
    return;
  }

  if (data && data.data && Array.isArray(data.data.subjects)) {
    state = {
      ...structuredClone(DEFAULT_DATA),
      ...data.data,
      schedule: Array.isArray(data.data.schedule) ? data.data.schedule : [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
  } else {
    await saveCloudWorkspace();
  }
}

authOpenBtn.addEventListener("click", () => {
  clearAuthMsg();
  authModal.classList.remove("hidden");
});

authCloseBtn.addEventListener("click", () => authModal.classList.add("hidden"));
authModal.addEventListener("click", (e) => {
  if (e.target === authModal) authModal.classList.add("hidden");
});

if (supabaseClient) {
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAuthMsg();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      showAuthMsg(error.message, "error");
      return;
    }
    currentUser = data.user;
    updateAuthUI();
    await loadCloudWorkspace();
    showAuthMsg("¡Sesión iniciada y datos sincronizados!", "success");
  });

  authSignupBtn.addEventListener("click", async () => {
    clearAuthMsg();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    if (!email || password.length < 6) {
      showAuthMsg("Ingresa un correo válido y contraseña de al menos 6 caracteres.", "error");
      return;
    }
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
      showAuthMsg(error.message, "error");
      return;
    }
    if (data.session) {
      currentUser = data.user;
      updateAuthUI();
      await loadCloudWorkspace();
      showAuthMsg("¡Cuenta creada y sincronizada!", "success");
    } else {
      showAuthMsg("Revisa tu correo para confirmar tu cuenta y luego inicia sesión.", "success");
    }
  });

  syncNowBtn.addEventListener("click", async () => {
    clearAuthMsg();
    await saveCloudWorkspace();
    showAuthMsg("Datos guardados en la nube ✓", "success");
  });

  authSignoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    currentUser = null;
    updateAuthUI();
    showAuthMsg("Sesión cerrada.", "");
  });

  supabaseClient.auth.getSession().then(async ({ data }) => {
    currentUser = data.session?.user || null;
    updateAuthUI();
    if (currentUser) {
      await loadCloudWorkspace();
    }
  });
}
