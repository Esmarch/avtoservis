/* =========================================================
   «ШинаПро» — скрипты.
   Каждый блок независим: если на странице нет нужного элемента,
   блок просто ничего не делает (удобно переносить в другие проекты).
   1) галерея   2) нижняя кнопка   3) телефон и отправка (общие помощники)
   4) калькулятор шиномонтажа   5) онлайн-запись   6) «Перезвоните мне»
   ========================================================= */

/* ---------- НАСТРОЙКИ ----------
   Адрес веб-приложения Google Apps Script, который пересылает заявки в Telegram.
   Как получить — в файле «НАСТРОЙКА-ФОРМЫ.md».
   Пока строка пустая, формы работают в демо-режиме: показывают «успех», ничего не отправляя. */
const FORM_ENDPOINT = "https://script.google.com/macros/s/AKfycbw0FLNCuWKYgL1PUVFZROeZAHWOIQyjWYumDYzmRiBlwoQf1AwWrlnkvVFdPYIycVE/exec";

/* Цены калькулятора — за комплект из 4 колёс, легковой автомобиль.
   Должны совпадать с таблицей в блоке «Услуги и цены» (index.html). */
const CALC = {
  // Группы радиусов: до R15 включительно, до R17, до R19, R20 и больше
  groups: [
    { maxRadius: 15, removal: 400, mount: 600, balance: 600 },
    { maxRadius: 17, removal: 500, mount: 750, balance: 750 },
    { maxRadius: 19, removal: 650, mount: 1000, balance: 950 },
    { maxRadius: 99, removal: 800, mount: 1250, balance: 1150 },
  ],
  // Коэффициент за тип автомобиля (ключи — value радиокнопок в index.html)
  carFactor: { "Легковой": 1, "Кроссовер": 1.2, "Внедорожник": 1.4 },
  storage: 2500,  // хранение комплекта — фиксированная цена за сезон, без коэффициента
  roundTo: 50,    // округляем итог до 50 ₽, чтобы не было «2 640 ₽»
};

/* Расписание онлайн-записи. Посты (боксы) и услуги — в index.html. */
const BOOKING = {
  daysAhead: 14,        // сколько дней вперёд можно записаться
  open: "08:00",        // начало рабочего дня
  close: "21:00",       // конец: работа должна закончиться к этому времени
  slotStep: 30,         // шаг сетки времени, минут
  leadMinutes: 60,      // на сегодня — не раньше чем через час от текущего времени
  // Нерабочие дни постов: 0 — вс, 1 — пн, … 6 — сб. Например: { "Бокс 3": [0] } — ремонт не работает в вс
  daysOff: {},
  // ДЕМО: доля «занятых» клеток. В демо занятость выдумана (одинаково при каждом заходе).
  // В реальном проекте свободные окна берут из календаря или CRM.
  demoBusyShare: 0.3,
};

const PHONE_TEXT = "+7 (999) 000-00-00"; // показываем, если отправка не удалась


/* ---------- 1. Галерея: увеличение фото по клику ---------- */
(function initGallery() {
  const links = [...document.querySelectorAll('.gallery__item')];
  if (!links.length) return;

  // Окно создаём скриптом: без JS оно не нужно — ссылка просто откроет фото
  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', 'Фото сервиса');
  dialog.innerHTML = `
    <div class="lightbox__inner">
      <img class="lightbox__img" alt="">
      <p class="lightbox__caption"></p>
    </div>
    <button type="button" class="lightbox__btn lightbox__close" aria-label="Закрыть">×</button>
    <button type="button" class="lightbox__btn lightbox__prev" aria-label="Предыдущее фото">‹</button>
    <button type="button" class="lightbox__btn lightbox__next" aria-label="Следующее фото">›</button>
  `;
  document.body.append(dialog);

  const img = dialog.querySelector('.lightbox__img');
  const caption = dialog.querySelector('.lightbox__caption');
  let current = 0;

  function show(index) {
    // По кругу: после последнего — снова первое
    current = (index + links.length) % links.length;
    const link = links[current];
    const alt = link.querySelector('img').alt;
    img.src = link.href;
    img.alt = alt;
    caption.textContent = `${alt} · ${current + 1} из ${links.length}`;
  }

  links.forEach((link, index) => {
    link.addEventListener('click', (event) => {
      event.preventDefault(); // не уходим со страницы на файл картинки
      show(index);
      dialog.showModal();
    });
  });

  dialog.querySelector('.lightbox__close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.lightbox__prev').addEventListener('click', () => show(current - 1));
  dialog.querySelector('.lightbox__next').addEventListener('click', () => show(current + 1));

  // Клик по тёмному фону (мимо фото и кнопок) — закрыть
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.classList.contains('lightbox__inner')) {
      dialog.close();
    }
  });

  // Стрелки на клавиатуре листают фото (Esc закрывает окно сам браузер)
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });

  // Свайп пальцем на телефоне
  let touchStartX = 0;
  dialog.addEventListener('touchstart', (event) => {
    touchStartX = event.touches[0].clientX;
  }, { passive: true });
  dialog.addEventListener('touchend', (event) => {
    const diff = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(diff) > 50) show(diff > 0 ? current - 1 : current + 1);
  });
})();


/* ---------- 2. Нижняя кнопка «Записаться» прячется, когда она не нужна ----------
   IntersectionObserver сообщает, виден ли элемент на экране — без постоянной проверки при прокрутке */
(function initStickyCta() {
  const cta = document.querySelector('.header__cta');
  const watched = [
    document.querySelector('.hero__actions'),
    document.querySelector('#calc-to-booking'),
    document.querySelector('#booking'),
    document.querySelector('#callback-form'),
  ].filter(Boolean);
  if (!cta || !watched.length || !('IntersectionObserver' in window)) return;

  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    });
    cta.classList.toggle('is-hidden', visible.size > 0);
  });

  watched.forEach((element) => observer.observe(element));
})();


/* ---------- 3. Общие помощники для форм ---------- */

// Маска телефона: что бы ни ввели, приводим к виду +7 (999) 123-45-67
function formatPhone(value) {
  let digits = value.replace(/\D/g, '');        // оставляем только цифры
  if (digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (!digits.startsWith('7')) digits = '7' + digits;
  // Набрали «8 999…» или «7 999…» после уже стоящего «+7» — лишнюю первую цифру убираем
  if (digits.length > 11 && /^7[78]/.test(digits)) digits = '7' + digits.slice(2);
  digits = digits.slice(0, 11);

  const d = digits.slice(1); // 10 цифр после «7»
  let result = '+7';
  if (d.length > 0) result += ' (' + d.slice(0, 3);
  // Скобку закрываем, только когда пошли следующие цифры, иначе её нельзя стереть
  if (d.length > 3) result += ') ' + d.slice(3, 6);
  if (d.length > 6) result += '-' + d.slice(6, 8);
  if (d.length > 8) result += '-' + d.slice(8, 10);
  return result;
}

const isPhoneOk = (value) => value.replace(/\D/g, '').length === 11;

// Подключаем маску ко всем полям телефона на странице
document.querySelectorAll('input[type="tel"]').forEach((input) => {
  input.addEventListener('input', () => { input.value = formatPhone(input.value); });
  // При фокусе на пустом поле сразу ставим «+7», чтобы было понятно, что вводить
  input.addEventListener('focus', () => { if (!input.value) input.value = '+7'; });
});

// Как только человек исправляет поле — убираем красную рамку
document.addEventListener('input', (event) => {
  if (event.target.matches('input')) event.target.setAttribute('aria-invalid', 'false');
});

// Сообщение под формой: type — 'ok' или 'error'
function showStatus(element, text, type) {
  element.textContent = text;
  element.classList.remove('status--ok', 'status--error');
  if (text) element.classList.add('status--' + type);
}

// Отправка в Apps Script. Без FORM_ENDPOINT — демо: ждём 0,7 с и «успех»
async function sendForm(fields) {
  if (!FORM_ENDPOINT) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    console.info('Демо-режим: заявка не отправлена, задайте FORM_ENDPOINT в script.js', fields);
    return;
  }
  // URLSearchParams — «простой» запрос, Google Apps Script принимает его без лишних настроек
  const response = await fetch(FORM_ENDPOINT, { method: 'POST', body: new URLSearchParams(fields) });
  const data = await response.json();
  if (!data.ok) throw new Error('Сервер вернул ошибку');
}

const rub = (n) => n.toLocaleString('ru-RU') + ' ₽';


/* ---------- 4. Калькулятор шиномонтажа ---------- */
(function initCalc() {
  const form = document.getElementById('calc-form');
  if (!form) return;

  const result = document.getElementById('calc-result');
  const toBooking = document.getElementById('calc-to-booking');
  const WORK_NAMES = {
    removal: 'снятие/установка',
    mount: 'монтаж шин',
    balance: 'балансировка',
    storage: 'хранение',
  };

  function calculate() {
    const radiusText = form.elements.radius.value;           // «R17»
    const radius = parseInt(radiusText.slice(1), 10);       // 17
    const car = form.elements.car.value;                     // «Кроссовер»
    const works = [...form.querySelectorAll('input[name="work"]:checked')].map((i) => i.value);

    const group = CALC.groups.find((g) => radius <= g.maxRadius);
    const factor = CALC.carFactor[car] || 1;

    // Работы с колёсами умножаем на коэффициент авто, хранение — фиксированная цена
    let total = 0;
    works.forEach((work) => {
      total += work === 'storage' ? CALC.storage : group[work] * factor;
    });
    total = Math.round(total / CALC.roundTo) * CALC.roundTo;

    return { radiusText, car, works, total };
  }

  function render() {
    const { works, total } = calculate();
    result.textContent = works.length ? rub(total) : 'выберите работы';
  }

  form.addEventListener('change', render);
  render();

  // «Записаться с этой ценой»: выбираем услугу в записи и пишем расчёт в комментарий
  toBooking?.addEventListener('click', () => {
    const { radiusText, car, works, total } = calculate();
    const bookingForm = document.getElementById('booking-form');
    if (!bookingForm || !works.length) return;

    const service = bookingForm.querySelector('input[name="service"][value="Шиномонтаж комплекта"]');
    if (service) {
      service.checked = true;
      // Сообщаем форме записи, что выбор изменился — она пересчитает боксы и свободное время
      service.dispatchEvent(new Event('change', { bubbles: true }));
    }
    bookingForm.elements.comment.value =
      `Калькулятор: ${radiusText}, ${car.toLowerCase()}, ${works.map((w) => WORK_NAMES[w]).join(' + ')} — ${rub(total)}`;
  });
})();


/* ---------- 5. Онлайн-запись ---------- */
(function initBooking() {
  const form = document.getElementById('booking-form');
  if (!form) return;

  const datesBox = document.getElementById('booking-dates');
  const slotsBox = document.getElementById('booking-slots');
  const summary = document.getElementById('booking-summary');
  const statusEl = form.querySelector('.booking__status');
  const submitBtn = form.querySelector('button[type="submit"]');
  const { name: nameInput, phone: phoneInput, car: carInput } = form.elements;
  const steps = form.querySelectorAll('.booking__step'); // 0 услуга, 1 пост, 2 дата, 3 время, 4 контакты

  const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // Посты берём из разметки (кроме «Любой»): { name: «Бокс 1», kind: «tire», label }
  const postInputs = [...form.querySelectorAll('input[name="post"]')];
  const posts = postInputs
    .filter((input) => input.value !== 'Любой')
    .map((input) => ({ name: input.value, kind: input.dataset.kind, label: input.closest('label') }));

  /* --- Время: работаем в минутах от полуночи, так проще считать --- */
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (minutes) =>
    String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');

  // «2026-11-14» по местному времени. toISOString() не подходит: он в UTC и ночью сдвигает дату
  const dateKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateFromKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const humanDate = (d) => `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;

  /* --- ДЕМО-занятость: «случайная», но одинаковая при каждом заходе ---
     Хеш превращает строку «дата|пост|время» в число от 0 до 1 */
  function demoBusy(key, post, minutes) {
    const text = `${key}|${post}|${minutes}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295 < BOOKING.demoBusyShare;
  }

  // Свободен ли пост всё время работы: с start до start + duration
  function isPostFree(date, post, start, duration) {
    if ((BOOKING.daysOff[post] || []).includes(date.getDay())) return false;
    for (let t = start; t < start + duration; t += BOOKING.slotStep) {
      if (demoBusy(dateKey(date), post, t)) return false;
    }
    return true;
  }

  // Посты, которые делают эту услугу (шиномонтаж — боксы 1–2, ремонт — бокс 3)
  const postsFor = (kind) => posts.filter((p) => !kind || p.kind === kind);

  // Все свободные окна на дату: [{ time: 600, post: «Бокс 1» }, …]
  function getFreeSlots(date, choice) {
    const now = new Date();
    const isToday = dateKey(date) === dateKey(now);
    const earliest = isToday ? now.getHours() * 60 + now.getMinutes() + BOOKING.leadMinutes : 0;
    const candidates = choice.post === 'Любой' ? postsFor(choice.kind).map((p) => p.name) : [choice.post];
    const slots = [];

    for (let t = toMinutes(BOOKING.open); t + choice.duration <= toMinutes(BOOKING.close); t += BOOKING.slotStep) {
      if (t < earliest) continue;
      const post = candidates.find((p) => isPostFree(date, p, t, choice.duration));
      if (post) slots.push({ time: t, post });
    }
    return slots;
  }

  /* --- Что сейчас выбрано в форме --- */
  function getChoice() {
    const service = form.querySelector('input[name="service"]:checked');
    return {
      service,
      kind: service?.dataset.kind || '',
      duration: service ? Number(service.dataset.duration) : BOOKING.slotStep,
      post: form.elements.post.value || 'Любой',
      date: form.querySelector('input[name="date"]:checked')?.value || '',
      time: form.querySelector('input[name="time"]:checked'),
    };
  }

  /* --- Боксы: прячем те, что не делают выбранную услугу --- */
  function renderPosts() {
    const { kind } = getChoice();
    posts.forEach((p) => {
      const fits = !kind || p.kind === kind;
      p.label.hidden = !fits;
      // Был выбран неподходящий бокс — возвращаем «Любой свободный»
      if (!fits && p.label.querySelector('input').checked) {
        form.querySelector('input[name="post"][value="Любой"]').checked = true;
      }
    });
  }

  // Карточка-«чип» для даты или времени. Создаём элементы, а не пишем HTML строкой —
  // так никакой текст не превратится случайно в код
  function makeChip(name, value, content, disabled) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.disabled = disabled;
    label.append(input, ...content);
    return label;
  }

  function hint(text) {
    const p = document.createElement('p');
    p.className = 'booking__hint';
    p.textContent = text;
    return p;
  }

  /* --- Даты: ближайшие N дней, дни без свободных окон недоступны --- */
  function renderDates() {
    const choice = getChoice();
    const today = new Date();
    const chips = [];

    for (let i = 0; i < BOOKING.daysAhead; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const free = getFreeSlots(d, choice).length > 0;
      const weekday = document.createElement('span');
      weekday.className = 'booking__weekday';
      weekday.textContent = i === 0 ? 'сегодня' : i === 1 ? 'завтра' : WEEKDAYS[d.getDay()];
      const day = document.createElement('b');
      day.className = 'booking__day';
      day.textContent = d.getDate();
      const month = document.createElement('span');
      month.className = 'booking__weekday';
      month.textContent = MONTHS[d.getMonth()].slice(0, 3);
      const chip = makeChip('date', dateKey(d), [weekday, day, month], !free);
      if (!free) chip.title = 'Нет свободных окон';
      chips.push(chip);
    }
    datesBox.replaceChildren(...chips);

    // Если выбранная дата всё ещё доступна — оставляем её выбранной
    const keep = datesBox.querySelector(`input[value="${choice.date}"]:not(:disabled)`);
    if (keep) keep.checked = true;
  }

  /* --- Время: свободные окна на выбранную дату --- */
  function renderSlots() {
    const choice = getChoice();
    const selected = choice.time?.value;

    if (!choice.service) return slotsBox.replaceChildren(hint('Сначала выберите услугу.'));
    if (!choice.date) return slotsBox.replaceChildren(hint('Выберите дату.'));

    const slots = getFreeSlots(dateFromKey(choice.date), choice);
    if (!slots.length) {
      return slotsBox.replaceChildren(hint('На этот день окон нет — выберите другую дату.'));
    }

    slotsBox.replaceChildren(...slots.map((slot) => {
      const chip = makeChip('time', toHHMM(slot.time), [toHHMM(slot.time)], false);
      chip.querySelector('input').dataset.post = slot.post; // какой бокс свободен в это время
      return chip;
    }));

    const keep = slotsBox.querySelector(`input[value="${selected}"]`);
    if (keep) keep.checked = true;
  }

  /* --- Итог: «Шиномонтаж комплекта · Бокс 1 · пт, 14 ноября · 10:00–11:00 · от 1 600 ₽» --- */
  function getBooking() {
    const { service, duration, post, date, time } = getChoice();
    if (!service || !date || !time) return null;
    const start = toMinutes(time.value);
    return {
      service: service.value,
      price: service.closest('label').querySelector('.chip__price')?.textContent || '',
      post: post === 'Любой' ? `${time.dataset.post} (выбран «любой»)` : post,
      postShort: post === 'Любой' ? time.dataset.post : post,
      date: humanDate(dateFromKey(date)),
      time: `${toHHMM(start)}–${toHHMM(start + duration)}`,
    };
  }

  function renderSummary() {
    const b = getBooking();
    summary.textContent = b ? `${b.service} · ${b.postShort} · ${b.date} · ${b.time} · ${b.price}` : '';
  }

  function refresh() {
    renderPosts();
    renderDates();
    renderSlots();
    renderSummary();
  }

  // При смене услуги/бокса пересчитываем всё, при выборе даты — время, при выборе времени — только итог
  form.addEventListener('change', (event) => {
    const name = event.target.name;
    if (name === 'service' || name === 'post') refresh();
    if (name === 'date') { renderSlots(); renderSummary(); }
    if (name === 'time') renderSummary();
    event.target.closest('.booking__step')?.classList.remove('is-invalid');
  });

  // Человек начал исправлять — старое сообщение об ошибке больше не нужно
  form.addEventListener('input', () => {
    if (statusEl.classList.contains('status--error')) showStatus(statusEl, '', 'ok');
  });

  refresh();

  // Проверяем по порядку шагов и возвращаем первую ошибку
  function validate() {
    const { service, date, time } = getChoice();
    const nameOk = nameInput.value.trim().length >= 2;
    const phoneOk = isPhoneOk(phoneInput.value);
    const carOk = carInput.value.trim().length >= 2;
    nameInput.setAttribute('aria-invalid', String(!nameOk));
    phoneInput.setAttribute('aria-invalid', String(!phoneOk));
    carInput.setAttribute('aria-invalid', String(!carOk));

    if (!service) return { step: steps[0], message: 'Выберите услугу' };
    if (!date) return { step: steps[2], message: 'Выберите дату' };
    if (!time) return { step: steps[3], message: 'Выберите время' };
    if (!nameOk) return { field: nameInput, message: 'Укажите, как к вам обращаться' };
    if (!phoneOk) return { field: phoneInput, message: 'Проверьте номер: нужно 10 цифр после +7' };
    if (!carOk) return { field: carInput, message: 'Укажите марку и модель авто' };
    if (!form.elements.agree.checked) return { field: form.elements.agree, message: 'Нужно согласие на обработку данных' };
    return null;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // не перезагружаем страницу, отправляем сами

    const error = validate();
    if (error) {
      showStatus(statusEl, error.message, 'error');
      if (error.step) {
        error.step.classList.add('is-invalid');
        error.step.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        error.field.focus();
      }
      return;
    }

    const booking = getBooking();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправляем…';
    showStatus(statusEl, '', 'ok');

    try {
      await sendForm({
        type: 'booking',
        name: nameInput.value.trim(),
        phone: phoneInput.value,
        car: carInput.value.trim(),
        service: booking.service,
        price: booking.price,
        post: booking.post,
        date: booking.date,
        time: booking.time,
        comment: form.elements.comment.value.trim(),
        website: form.elements.website.value, // ловушка для ботов
      });
      form.reset();
      refresh();
      showStatus(statusEl, `Готово! Вы записаны: ${booking.date}, ${booking.time}, ${booking.postShort}. ` +
        'Подтвердим в течение 15 минут.', 'ok');
    } catch (err) {
      console.error(err);
      showStatus(statusEl, `Не получилось отправить. Позвоните нам: ${PHONE_TEXT}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Записаться';
    }
  });
})();


/* ---------- 6. Форма «Перезвоните мне» ---------- */
(function initCallback() {
  const form = document.getElementById('callback-form');
  if (!form) return;

  const statusEl = form.querySelector('.callback__status');
  const submitBtn = form.querySelector('button[type="submit"]');
  const { name: nameInput, phone: phoneInput } = form.elements;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const nameOk = nameInput.value.trim().length >= 2;
    const phoneOk = isPhoneOk(phoneInput.value);
    nameInput.setAttribute('aria-invalid', String(!nameOk));
    phoneInput.setAttribute('aria-invalid', String(!phoneOk));

    if (!nameOk) { showStatus(statusEl, 'Укажите, как к вам обращаться', 'error'); return nameInput.focus(); }
    if (!phoneOk) { showStatus(statusEl, 'Проверьте номер: нужно 10 цифр после +7', 'error'); return phoneInput.focus(); }
    if (!form.elements.agree.checked) { showStatus(statusEl, 'Нужно согласие на обработку данных', 'error'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправляем…';
    showStatus(statusEl, '', 'ok');

    try {
      await sendForm({
        type: 'callback',
        name: nameInput.value.trim(),
        phone: phoneInput.value,
        question: form.elements.question.value.trim(),
        website: form.elements.website.value,
      });
      form.reset();
      showStatus(statusEl, 'Спасибо! Перезвоним в течение 15 минут в рабочее время (8:00–21:00).', 'ok');
    } catch (err) {
      console.error(err);
      showStatus(statusEl, `Не получилось отправить. Позвоните нам: ${PHONE_TEXT}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Жду звонка';
    }
  });
})();
