# Energie-Monats-Karte-fuer-Trockner-und-Waschmaschine

# Bad Energy Month Card

Eine Lovelace Custom Card für Home Assistant zur Anzeige von Waschmaschine, Trockner, Monatsverbrauch und Kosten.

## Installation über HACS

1. HACS öffnen
2. Drei Punkte oben rechts
3. Benutzerdefinierte Repositories
4. Repository-URL einfügen
5. Kategorie: Lovelace / Frontend auswählen
6. Hinzufügen
7. Karte herunterladen

## Resource

Nach der Installation muss die Ressource in Home Assistant so eingebunden werden:

/hacsfiles/bad-energy-month-card/bad-energy-month-card.js

Typ: JavaScript-Modul

## Beispiel

```yaml
type: custom:bad-energy-month-card
price_entity: input_number.energiepreis_kwh
washer_energy: sensor.bad_waschmaschine_energy_total
dryer_energy: sensor.bad_trockner_energy_total
washer_status: sensor.waschmaschine_status
dryer_status: sensor.trockner_status
washer_runs_statistic: sensor.bad_waschmaschine_laeufe_statistik
dryer_runs_statistic: sensor.bad_trockner_laeufe_statistik
washer_icon: mdi:washing-machine
dryer_icon: mdi:tumble-dryer
