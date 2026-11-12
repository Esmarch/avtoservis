/**
 * Google Apps Script: принимает заявки с сайта автосервиса и пересылает их в Telegram.
 * Два вида заявок:
 *   type = "booking"  — онлайн-запись (услуга, бокс, дата, время, авто)
 *   type = "callback" — «Перезвоните мне» (имя, телефон, вопрос)
 *
 * Зачем посредник: токен бота нельзя класть в script.js — его увидит любой
 * посетитель (F12) и сможет писать от имени бота. Здесь токен хранится
 * в «Свойствах скрипта» на стороне Google, сайт его не знает.
 *
 * Куда вставить и как настроить — в файле «НАСТРОЙКА-ФОРМЫ.md».
 */

function doPost(e) {
  const p = e.parameter || {};

  // Ловушка для ботов: человек это поле не заполняет
  if (p.website) return json({ ok: true });

  const name = clean(p.name, 100);
  const phone = clean(p.phone, 30);
  if (!name || phone.replace(/\D/g, "").length !== 11) {
    return json({ ok: false, error: "bad_input" });
  }

  let lines;

  if (p.type === "callback") {
    const question = clean(p.question, 1000);
    lines = [
      "📞 Перезвоните мне",
      "",
      "👤 " + name,
      "📞 " + phone,
      question ? "❓ " + question : null,
    ];
  } else {
    const service = clean(p.service, 100);
    const price = clean(p.price, 30);
    const post = clean(p.post, 100);
    const date = clean(p.date, 50);
    const time = clean(p.time, 20);
    const car = clean(p.car, 100);
    const comment = clean(p.comment, 1000);

    // Без этих данных запись бессмысленна — не отправляем
    if (!service || !date || !time) return json({ ok: false, error: "bad_input" });

    lines = [
      "🛞 Новая запись с сайта",
      "",
      "📅 " + date + ", " + time,
      "🔧 " + service + (price ? " — " + price : ""),
      "🏁 " + (post || "любой бокс"),
      "🚗 " + (car || "авто не указано"),
      comment ? "💬 " + comment : null,
      "",
      "👤 " + name,
      "📞 " + phone,
      "",
      "Позвоните клиенту, чтобы подтвердить запись.",
    ];
  }

  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("BOT_TOKEN");
  const chatId = props.getProperty("CHAT_ID");

  const response = UrlFetchApp.fetch(
    "https://api.telegram.org/bot" + token + "/sendMessage",
    {
      method: "post",
      contentType: "application/json",
      // null — строки, которых нет (например, без комментария): убираем их
      payload: JSON.stringify({ chat_id: chatId, text: lines.filter((line) => line !== null).join("\n") }),
      muteHttpExceptions: true, // не падать, а вернуть ошибку сайту
    }
  );

  return json({ ok: response.getResponseCode() === 200 });
}

// Обрезаем длинный текст и лишние пробелы
function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Запустите эти функции вручную в редакторе, чтобы проверить отправку в Telegram
function testBooking() {
  const result = doPost({
    parameter: {
      type: "booking",
      name: "Тест",
      phone: "+7 (999) 123-45-67",
      car: "Kia Rio",
      service: "Шиномонтаж комплекта",
      price: "от 1 600 ₽",
      post: "Бокс 1",
      date: "пт, 14 ноября",
      time: "10:00–11:00",
      comment: "Калькулятор: R15, легковой, снятие/установка + монтаж шин + балансировка — 1 600 ₽",
    },
  });
  Logger.log(result.getContent());
}

function testCallback() {
  const result = doPost({
    parameter: { type: "callback", name: "Тест", phone: "+7 (999) 123-45-67", question: "Сколько стоит ремонт пореза?" },
  });
  Logger.log(result.getContent());
}
