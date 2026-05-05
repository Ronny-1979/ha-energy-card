// ============================================================
// HA Energy Card – Home Assistant Custom Card
// Zeigt Energie- und Kostenübersicht für Waschmaschine und
// Trockner, monatsweise navigierbar mit Jahresübersicht.
// ============================================================

class HaEnergyCard extends HTMLElement {

  static getConfigElement() {
    return document.createElement("ha-energy-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:ha-energy-card"
    };
  }

  setConfig(config) {
    this.config = config;
    this.offset = 0; // 0 = aktueller Monat, negative Werte = vergangene Monate
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  // Gemeinsame Hilfsfunktion für alle Recorder-Abfragen.
  // Gibt die Differenz zwischen erstem und letztem Tageswert zurück (= Verbrauch im Zeitraum).
  async _queryRecorder(entityId, start, end) {
    const result = await this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: [entityId],
      period: "day",
      types: ["sum"]
    });

    const data = result[entityId];
    if (!data || !data.length) return 0;

    const first = data[0]?.sum ?? 0;
    const last  = data[data.length - 1]?.sum ?? first;

    return Math.max(0, last - first);
  }

  // Liest Verbrauch oder Laufzähler eines Sensors für den gewählten Monat
  async getMonthStats(entityId, offset) {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0);
    const end   = offset === 0
      ? now
      : new Date(now.getFullYear(), now.getMonth() + offset + 1, 1, 0, 0, 0);

    return this._queryRecorder(entityId, start, end);
  }

  // Liest den Energieverbrauch vom 1. Januar bis zum Ende des gewählten Monats
  // für die Jahresübersicht
  async getYearStats(entityId, offset) {
    const now      = new Date();
    const selected = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0);
    const start    = new Date(selected.getFullYear(), 0, 1, 0, 0, 0);
    const end      = (selected.getFullYear() === now.getFullYear() && selected.getMonth() === now.getMonth())
      ? now
      : new Date(selected.getFullYear(), selected.getMonth() + 1, 1, 0, 0, 0);

    return this._queryRecorder(entityId, start, end);
  }

  // Vergleicht den Sensor-Wert mit dem konfigurierten "läuft"-Wert
  _isRunning(status, type) {
    const st  = String(status || "").toLowerCase();
    const val = (type === "dryer"
      ? this.config.dryer_running_value
      : this.config.washer_running_value).toLowerCase();
    return st === val;
  }

  // Gibt die Icon-Farbe zurück: grün (Waschmaschine läuft), blau (Trockner läuft),
  // gedimmtes Weiß (aus / unbekannt)
  getStatusColor(status, type) {
    if (!this._isRunning(status, type)) return "rgba(255,255,255,0.55)";
    return type === "dryer" ? "rgb(0,200,255)" : "rgb(0,255,160)";
  }

  // Gibt den Anzeigetext zurück: fest im Code definiert
  // Waschmaschine: "Wäscht" / "Aus" – Trockner: "Trocknet" / "Aus"
  getStatusLabel(status, type) {
    if (!this._isRunning(status, type)) return "Aus";
    return type === "dryer" ? "Trocknet" : "Wäscht";
  }

  // Lädt alle Daten und baut das komplette Karten-HTML neu auf
  async render() {
    if (!this._hass || this.loading) return;
    this.loading = true;

    const cfg   = this.config;
    const price = parseFloat(this._hass.states[cfg.price_entity]?.state ?? 0);

    // Monats- und Jahresverbrauch laden
    const [washerKwh, dryerKwh, yearWasherKwh, yearDryerKwh] = await Promise.all([
      this.getMonthStats(cfg.washer_energy, this.offset),
      this.getMonthStats(cfg.dryer_energy,  this.offset),
      this.getYearStats(cfg.washer_energy,  this.offset),
      this.getYearStats(cfg.dryer_energy,   this.offset)
    ]);

    // Kosten berechnen
    const totalKwh       = washerKwh + dryerKwh;
    const yearTotalKwh   = yearWasherKwh + yearDryerKwh;
    const washerCost     = washerKwh * price;
    const totalCost      = totalKwh * price;
    const yearTotalCost  = yearTotalKwh * price;
    const yearWasherCost = yearWasherKwh * price;
    const yearDryerCost  = yearDryerKwh * price;

    // Status und Labels lesen
    const washerStatus      = this._hass.states[cfg.washer_status]?.state ?? "";
    const dryerStatus       = this._hass.states[cfg.dryer_status]?.state  ?? "";
    const washerStatusLabel = this.getStatusLabel(washerStatus, "washer");
    const dryerStatusLabel  = this.getStatusLabel(dryerStatus,  "dryer");
    const washerIconColor   = this.getStatusColor(washerStatus, "washer");
    const dryerIconColor    = this.getStatusColor(dryerStatus,  "dryer");

    // Läufe lesen: aktueller Monat → Live-Sensor, vergangene Monate → Recorder
    let washerRuns, dryerRuns;
    if (this.offset === 0) {
      washerRuns = this._hass.states[cfg.washer_runs_statistic]?.state ?? "0";
      dryerRuns  = this._hass.states[cfg.dryer_runs_statistic]?.state  ?? "0";
    } else {
      [washerRuns, dryerRuns] = (await Promise.all([
        this.getMonthStats(cfg.washer_runs_statistic, this.offset),
        this.getMonthStats(cfg.dryer_runs_statistic,  this.offset)
      ])).map(v => Number(v).toFixed(0));
    }

    // Angezeigten Monatsnamen ermitteln
    const d = new Date();
    d.setMonth(d.getMonth() + this.offset);
    const monthNames = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
    const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;

    this.shadowRoot.innerHTML = `
      <style>
        /* Grundlayout und Abstände */
        .wrap {
          width: min(955px, calc(100vw - 24px));
          padding: clamp(4px, 1vh, 10px) 0 0 clamp(0px, 2vw, 24px);
          color: white;
          font-family: var(--primary-font-family);
          box-sizing: border-box;
        }

        /* Navigationszeile: Button – Header – Button */
        .toprow {
          display: grid;
          grid-template-columns: clamp(34px, 4.5vw, 44px) 1fr clamp(34px, 4.5vw, 44px);
          gap: clamp(4px, 1vw, 8px);
          align-items: center;
          margin-bottom: clamp(4px, 1vh, 8px);
        }

        button {
          width: clamp(34px, 4.5vw, 44px);
          height: clamp(34px, 4.5vw, 44px);
          border-radius: 50%;
          border: 1px solid rgba(0,220,255,0.3);
          background: rgba(0,220,255,0.15);
          color: rgba(0,220,255,0.95);
          font-size: clamp(22px, 3vw, 30px);
          cursor: pointer;
          box-shadow: none;
          padding: 0;
        }

        /* Haupt-Header mit Titel, Monat und Strompreis */
        .header {
          text-align: center;
          border-radius: clamp(18px, 2.5vw, 28px);
          padding: clamp(10px, 2vh, 20px) clamp(8px, 1.5vw, 12px);
          background:
            radial-gradient(900px 280px at 50% 0%, rgba(0,220,255,0.18), transparent 60%),
            linear-gradient(135deg, rgba(40,60,90,0.58), rgba(14,22,38,0.84));
          box-shadow:
            0 18px 46px rgba(0,0,0,0.55),
            inset 0 0 0 1px rgba(255,255,255,0.08);
        }

        .header .title {
          font-size: clamp(26px, 4vh, 42px);
          font-weight: 950;
          line-height: 1.05;
          text-shadow: 0 2px 14px rgba(0,0,0,0.35);
        }

        .header .month {
          font-size: clamp(14px, 2vh, 18px);
          font-weight: 800;
          line-height: 1.35;
        }

        /* Zwei Gerätekacheln nebeneinander */
        .cards {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: clamp(4px, 1vw, 8px);
          margin-top: clamp(4px, 1vh, 8px);
        }

        /* Gerätekacheln und Zusammenfassungskacheln – gemeinsames Styling */
        .device, .total {
          display: grid;
          grid-template-columns: clamp(58px, 8vw, 84px) 1fr;
          column-gap: clamp(8px, 1.5vw, 14px);
          align-items: center;
          border-radius: clamp(18px, 2.5vw, 26px);
          padding: clamp(12px, 2.3vh, 22px) clamp(12px, 1.9vw, 18px) clamp(14px, 2.5vh, 24px) clamp(12px, 1.9vw, 18px);
          background:
            radial-gradient(850px 260px at 50% 0%, rgba(0,255,160,0.16), transparent 60%),
            linear-gradient(135deg, rgba(22,34,54,0.78), rgba(14,22,38,0.86));
          box-shadow:
            0 16px 38px rgba(0,0,0,0.55),
            inset 0 0 0 1px rgba(255,255,255,0.07);
          overflow: hidden;
        }

        /* Trockner-Kachel mit blauem statt grünem Farbakzent */
        .dryer {
          background:
            radial-gradient(850px 260px at 50% 0%, rgba(0,200,255,0.16), transparent 60%),
            linear-gradient(135deg, rgba(22,34,54,0.78), rgba(14,22,38,0.86));
        }

        /* Monats- und Jahresübersicht */
        .total {
          margin-top: clamp(4px, 1vh, 8px);
          grid-template-columns: clamp(62px, 8vw, 90px) 1fr;
          border-radius: clamp(18px, 2.5vw, 28px);
          padding: clamp(10px, 1.8vh, 26px) clamp(14px, 2vw, 22px);
          background:
            radial-gradient(900px 280px at 50% 0%, rgba(0,255,200,0.14), transparent 60%),
            linear-gradient(165deg, rgba(25,45,65,0.76), rgba(12,22,34,0.90));
        }

        /* Icon-Bereich und Größen */
        .bigicon {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .bigicon ha-icon {
          width: clamp(48px, 7vh, 74px);
          height: clamp(48px, 7vh, 74px);
          --mdc-icon-size: clamp(48px, 7vh, 74px);
          filter: drop-shadow(0 8px 12px rgba(0,0,0,0.42));
        }

        .total .bigicon ha-icon {
          width: clamp(44px, 6vh, 78px);
          height: clamp(44px, 6vh, 78px);
          --mdc-icon-size: clamp(44px, 6vh, 78px);
          color: rgb(0,255,200);
        }

        /* Textbereich: Name und Statuszeilen */
        .content {
          text-align: center;
          min-width: 0;
        }

        .name {
          font-size: clamp(24px, 3.6vh, 36px);
          font-weight: 900;
          line-height: 1.05;
          white-space: nowrap;
          text-shadow: 0 2px 14px rgba(0,0,0,0.35);
        }

        .state {
          font-size: clamp(17px, 2.7vh, 26px);
          font-weight: 800;
          line-height: 1.18;
          text-shadow: 0 2px 14px rgba(0,0,0,0.35);
        }

        .total .name {
          font-size: clamp(26px, 4vh, 42px);
          font-weight: 950;
        }

        .total .state {
          font-size: clamp(20px, 3vh, 34px);
          line-height: 1.15;
        }

        /* Kompaktere Abstände auf kleinen Bildschirmen (Höhe) */
        @media (max-height: 760px) {
          .header { padding-top: 10px; padding-bottom: 10px; }
          .device { padding-top: 12px; padding-bottom: 12px; }
          .total  { padding-top: 9px;  padding-bottom: 9px;  }
          .state  { line-height: 1.12; }
          .total .state { line-height: 1.1; }
        }

        /* Auf schmalen Bildschirmen Kacheln untereinander */
        @media (max-width: 720px) {
          .wrap  { width: 100%; padding-left: 0; }
          .cards { grid-template-columns: 1fr; }
          .name  { white-space: normal; }
        }
      </style>

      <div class="wrap">
        <div class="toprow">
          <button id="prev">‹</button>

          <div class="header">
            <div class="title">⚡ Energieübersicht</div>
            <div class="month">${label}<br>🪙 ${price.toFixed(2)} €/kWh</div>
          </div>

          <button id="next">›</button>
        </div>

        <div class="cards">
          <div class="device">
            <div class="bigicon">
              <ha-icon icon="${cfg.washer_icon || "mdi:washing-machine"}" style="color: ${washerIconColor};"></ha-icon>
            </div>
            <div class="content">
              <div class="name">Waschmaschine</div>
              <div class="state">
                Status: ${washerStatusLabel}<br>
                Läufe: ${washerRuns} ×<br>
                Verbrauch: ${washerKwh.toFixed(2)} kWh<br>
                Kosten: ${washerCost.toFixed(2)} €
              </div>
            </div>
          </div>

          <div class="device dryer">
            <div class="bigicon">
              <ha-icon icon="${cfg.dryer_icon || "mdi:tumble-dryer"}" style="color: ${dryerIconColor};"></ha-icon>
            </div>
            <div class="content">
              <div class="name">Trockner</div>
              <div class="state">
                Status: ${dryerStatusLabel}<br>
                Läufe: ${dryerRuns} ×<br>
                Verbrauch: ${dryerKwh.toFixed(2)} kWh<br>
                Kosten: ${(dryerKwh * price).toFixed(2)} €
              </div>
            </div>
          </div>
        </div>

        <div class="total">
          <div class="bigicon">
            <ha-icon icon="mdi:cash-multiple"></ha-icon>
          </div>
          <div class="content">
            <div class="name">💰 Monatsübersicht</div>
            <div class="state">
              Gesamtverbrauch: ${totalKwh.toFixed(2)} kWh<br>
              Gesamtkosten: ${totalCost.toFixed(2)} €
            </div>
          </div>
        </div>

        <div class="total">
          <div class="bigicon">
            <ha-icon icon="mdi:calendar-range"></ha-icon>
          </div>
          <div class="content">
            <div class="name">📆 Jahresübersicht</div>
            <div class="state">
              🧺 ${yearWasherKwh.toFixed(2)} kWh / ${yearWasherCost.toFixed(2)} € &nbsp;|&nbsp; 🌬️ ${yearDryerKwh.toFixed(2)} kWh / ${yearDryerCost.toFixed(2)} €<br>
              Jahresverbrauch: ${yearTotalKwh.toFixed(2)} kWh<br>
              Jahreskosten: ${yearTotalCost.toFixed(2)} €
            </div>
          </div>
        </div>
      </div>
    `;

    // Monatsnavigation
    this.shadowRoot.getElementById("prev").onclick = () => { this.offset--; this.loading = false; this.render(); };
    this.shadowRoot.getElementById("next").onclick = () => { this.offset++; this.loading = false; this.render(); };

    this.loading = false;
  }

  getCardSize() {
    return 7;
  }
}

customElements.define("ha-energy-card", HaEnergyCard);


// ============================================================
// Editor – wird im HA-Karten-Editor geladen
// ============================================================

class HaEnergyCardEditor extends HTMLElement {

  setConfig(config) {
    this.config = config || {};
    this.render();
  }

  set hass(hass) {
    this._hass = hass;

    if (!this._rendered) {
      this.render();
    } else {
      // Bei Folgeaufrufen nur hass in bestehende Picker einhängen
      this.querySelectorAll("ha-entity-picker, ha-icon-picker").forEach((el) => {
        if (el.tagName.toLowerCase() === "ha-entity-picker") el.hass = this._hass;
      });
    }
  }

  render() {
    if (!this._hass) return;
    this.config = this.config || {};
    this._rendered = true;

    this.innerHTML = `
      <style>
        .editor {
          display: grid;
          gap: 14px;
          padding: 8px;
        }

        .section {
          font-weight: 700;
          font-size: 16px;
          margin-top: 10px;
        }

        /* Label über dem Icon-Picker passend zum HA-Stil */
        .field-title {
          font-size: 13px;
          font-weight: 400;
          color: var(--primary-text-color);
          padding: 4px 16px;
          margin: 0 -8px;
          background: rgba(0,0,0,0.3);
          letter-spacing: 0.01em;
        }

        ha-entity-picker, ha-icon-picker { width: 100%; }
        ha-textfield { width: 100%; }
      </style>

      <div class="editor">
        <div class="section">Allgemein</div>
        <ha-entity-picker id="price_entity" label="Strompreis Sensor" required></ha-entity-picker>

        <div class="section">Waschmaschine</div>
        <ha-entity-picker id="washer_energy" label="Waschmaschine Energie Sensor"></ha-entity-picker>
        <ha-entity-picker id="washer_status" label="Waschmaschine Status Sensor"></ha-entity-picker>
        <ha-textfield id="washer_running_value" label="Status: Läuft" placeholder="z.B. on" required></ha-textfield>
        <ha-entity-picker id="washer_runs_statistic" label="Waschmaschine Läufe Statistik Sensor"></ha-entity-picker>
        <div class="field-title">Waschmaschine Icon</div>
        <ha-icon-picker id="washer_icon"></ha-icon-picker>

        <div class="section">Trockner</div>
        <ha-entity-picker id="dryer_energy" label="Trockner Energie Sensor"></ha-entity-picker>
        <ha-entity-picker id="dryer_status" label="Trockner Status Sensor"></ha-entity-picker>
        <ha-textfield id="dryer_running_value" label="Status: Läuft" placeholder="z.B. on" required></ha-textfield>
        <ha-entity-picker id="dryer_runs_statistic" label="Trockner Läufe Statistik Sensor"></ha-entity-picker>
        <div class="field-title">Trockner Icon</div>
        <ha-icon-picker id="dryer_icon"></ha-icon-picker>
      </div>
    `;

    const fields = [
      "price_entity",
      "washer_energy", "washer_status", "washer_running_value", "washer_runs_statistic", "washer_icon",
      "dryer_energy",  "dryer_status",  "dryer_running_value",  "dryer_runs_statistic",  "dryer_icon"
    ];

    // Standardwerte falls nichts konfiguriert ist
    const defaults = {
      washer_icon: "mdi:washing-machine",
      dryer_icon:  "mdi:tumble-dryer"
    };

    // Jeden Picker initialisieren: hass setzen, Wert laden, Änderungen hören
    fields.forEach((field) => {
      const el = this.querySelector(`#${field}`);
      if (!el) return;

      if (el.tagName.toLowerCase() === "ha-entity-picker") el.hass = this._hass;

      el.value = this.config[field] || defaults[field] || "";

      el.addEventListener("value-changed", (ev) => this.valueChanged(field, ev.detail.value));
      el.addEventListener("input",         (ev) => this.valueChanged(field, ev.target.value));
    });
  }

  // Speichert geänderte Felder und feuert config-changed damit HA die Konfiguration übernimmt
  valueChanged(configValue, value) {
    if (!configValue) return;

    const newConfig = { ...this.config, [configValue]: value };
    this.config = newConfig;

    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: newConfig },
      bubbles: true,
      composed: true
    }));
  }
}

customElements.define("ha-energy-card-editor", HaEnergyCardEditor);
