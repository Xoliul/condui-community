---
title: Symbole für Stromlaufplan und Lageplan
description: Elektrische Symbole für Ihren belgischen Stromlaufplan (Eendraadschema) und Lageplan mit kurzer Erklärung je Symbol, von Steckdose und Wechselschalter bis FI-Schutzschalter und Erdungstrennstelle.
updated: 2026-11-04
---

Hier finden Sie die elektrischen Symbole, die auf einem belgischen Stromlaufplan (Eendraadschema) und Lageplan vorkommen, mit einer kurzen Erklärung je Symbol. Die meisten entsprechen Tabelle 2.23 des AREI Buch 1 (Kapitel 2.13), einer nicht abschließenden Liste. Für Bauteile, die dort fehlen, etwa einen Heimspeicher oder einen Überspannungsschutz, verwendet {{brand}} ein eigenes Symbol.

Klicken Sie auf ein Symbol, um seine Varianten und einen Link zur passenden Erklärung zu sehen.

:::condui title="Nützlich mit Condui"
Sie müssen diese Symbole nicht selbst zeichnen. In Condui wählen Sie ein Gerät, und das passende Symbol erscheint auf Ihrem Stromlaufplan und Lageplan.
:::

## [grid] Netz und Erdung
Wo der Strom ins Haus kommt, die Erdung und die Dosen und Kästen, in denen Leitungen zusammenkommen.

### [mains]
Der Ausgangspunkt Ihres Stromlaufplans: die Einspeisung aus dem Verteilnetz. Geben Sie Phasenzahl und Spannung an, zum Beispiel 1N 230 V, 3 × 230 V oder 3N 400 V.

### [backup_feed]
Eine zweite Stromquelle, etwa ein Generator oder der Notstromausgang eines Hybridwechselrichters.

### [earthing]
Der Erder der Anlage, meist ein Fundamenterder oder ein Staberder. Notieren Sie den gemessenen Ausbreitungswiderstand.

### [earthing_separator]
Die Erdungstrennstelle trennt die Erdungsleitung von der Haupterdungsklemme, damit Sie den Ausbreitungswiderstand des Erders messen können.

### [panel_distribution]
Die Schalt- und Verteilertafel, in der Leitungsschutzschalter und FI-Schutzschalter die Stromkreise speisen. Im Lageplan zeigt sie, wo der Verteiler hängt.

### [junction_box]
Eine Verbindungs- oder Abzweigdose, in der Leitungen verbunden oder abgezweigt werden.

### [junction_panel]
Ein Abzweigkasten: ein größerer Kasten, in dem mehrere Leitungen verbunden oder verteilt werden, ohne Schutzgeräte.

### [terminal_strip]
Eine Klemmleiste, eine Reihe von Anschlussklemmen, auf denen Leiter verbunden werden, etwa im Verteiler oder Technikschrank.

## [protection] Schutzgeräte
Geräte, die einen Stromkreis bei Überlast, Kurzschluss, Fehlerstrom oder Überspannung abschalten.

### [mcb]
Ein Leitungsschutzschalter schützt einen Stromkreis vor Überlast und Kurzschluss. Geben Sie Polzahl, Nennstrom und Charakteristik an, zum Beispiel 2P 20 A Kurve C.

### [rcd]
Ein FI-Schutzschalter schaltet ab, sobald Strom zur Erde abfließt. Geben Sie Empfindlichkeit, Typ und Nennstrom an, zum Beispiel 300 mA Typ A 40 A.

### [rcbo]
Ein FI/LS-Schalter vereint Leitungsschutzschalter und FI-Schutzschalter in einem Gerät für einen Stromkreis. Geben Sie die Werte beider an.

### [fuse]
Eine Schmelzsicherung schützt vor Überstrom, indem sie durchschmilzt. Geben Sie Strom und Typ an, zum Beispiel 16 A gG.

### [spd]
Ein Überspannungsschutz leitet kurze Spannungsspitzen, etwa durch einen nahen Blitzeinschlag, zur Erde ab.

### [rotating_switch]
Ein Drehschalter mit mehreren Stellungen, etwa als Reparaturschalter an einer Wärmepumpe oder zur Wahl einer Betriebsart.

### [source_changeover]
Ein Netzumschalter wählt zwischen zwei Einspeisungen, etwa Netz und Generator, damit sie nie gleichzeitig an der Anlage liegen.

## [outlets] Steckdosen
Steckdosen und ihre Varianten. Das Symbol zeigt Schutzkontakt und Kinderschutz.

### [socket_gnd_child]
Die übliche Steckdose in einer belgischen Wohnung: mit Erdungsstift und Kinderschutz.

### [double_socket_gnd_child]
Zwei Steckdosen mit Erdungsstift und Kinderschutz in einer Unterputzdose.

### [socket_child]
Eine Steckdose mit Kinderschutz, aber ohne Erdungsstift, wie man sie noch in älteren Anlagen findet.

### [double_socket_child]
Zwei Steckdosen mit Kinderschutz, ohne Erdungsstift, in einer Unterputzdose.

### [modular_socket]
Eine Reiheneinbau-Steckdose auf der Hutschiene im Verteiler, etwa für einen Router oder ein Smart-Home-Modul.

### [socket_gnd]
Eine Steckdose mit Erdungsstift, ohne Kinderschutz.

### [socket]
Das allgemeine Symbol für eine Steckdose. Erdung, Kinderschutz oder einen Schalter fügen Sie über die Varianten hinzu.

## [switches] Schalter und Steuerung
Alles, womit Sie einen Stromkreis oder ein Gerät bedienen, vom einfachen Schalter bis zum Relais.

### [switch]
Ein Ausschalter schaltet einen Lichtauslass oder ein Gerät von einer Stelle aus ein und aus. Es gibt Varianten mit 1, 2, 3 oder 4 Polen und mit Kontrolllampe.

### [switch_1p_twoway]
Ein Wechselschalter schaltet einen Lichtauslass von zwei Stellen aus, etwa unten und oben an der Treppe.

### [switch_cross]
Ein Kreuzschalter sitzt zwischen zwei Wechselschaltern, sodass Sie von drei oder mehr Stellen schalten, etwa in einem langen Flur.

### [switch_dimmer]
Ein Dimmer regelt die Helligkeit eines Lichtauslasses.

### [switch_1p_changeover]
Ein Serienschalter bedient zwei Stromkreise getrennt von einer Stelle aus, etwa Deckenlicht und Spots im Wohnzimmer.

### [switch_shutter]
Ein Rollladenschalter steuert die Auf- und Abbewegung eines Rollladens oder einer Jalousie. Stellen Sie den angetriebenen Motor als separates Gerät dar.

### [switch_1p_pull]
Ein Zugschalter wird über eine Schnur bedient, vor allem in älteren Badezimmern.

### [contact]
Ein einzelner Kontakt, etwa ein Türkontakt oder ein Eingang eines Smart-Home-Systems.

### [switch_impulse]
Ein Taster gibt einen kurzen Impuls an einen Stromstoßschalter oder Smart-Home-Eingang, statt den Stromkreis direkt zu schalten.

### [light_sensor]
Ein Dämmerungsschalter schaltet die Beleuchtung automatisch ein, wenn das Umgebungslicht unter den eingestellten Schwellenwert fällt. Die beiden Pfeile zum Kontakt zeigen, dass er auf Licht reagiert. Es handelt sich um einen lichtgesteuerten Schalter, keinen Bewegungsmelder.

### [motion_detector]
Ein Bewegungsmelder schaltet das Licht bei Bewegung automatisch. Sie können die Technik angeben: IR, Radar oder eine Kombination.

### [smoke_detector]
Ein netzbetriebener Rauchmelder, gegebenenfalls mit anderen Meldern vernetzt.

### [relay]
Ein Relais oder Stromstoßschalter im Verteiler schaltet einen Stromkreis auf ein Steuersignal. Es gibt Varianten für Zeitschalter, Schaltuhr, Impuls, Thermostat und Dimmer.

## [lighting] Beleuchtung
Lichtauslässe und Leuchten, wie Sie sie im Lageplan je Raum zeichnen.

### [light_point]
Ein Lichtauslass ist der Anschlusspunkt für eine Leuchte an Decke oder Wand. Es gibt Varianten für Sicherheitsbeleuchtung und mit eingebautem Schalter.

### [light_spot]
Ein Strahler mit gerichtetem Lichtbündel, mit Varianten für ein wenig und ein stark streuendes Bündel.

### [light_led]
Eine LED-Leuchte, etwa ein LED-Panel oder LED-Streifen.

### [light_fluorescent]
Eine Leuchtstofflampe oder Leuchtstoffröhre.

## [appliances] Fest angeschlossene Geräte
Haushaltsgeräte und andere feste Verbraucher. So zeigt der Plan, an welchem Stromkreis jedes Gerät hängt.

### [stove]
Ein Elektroherd oder Kochfeld, meist an einem eigenen Stromkreis.

### [oven]
Ein Elektrobackofen.

### [washer]
Eine Waschmaschine.

### [dryer]
Ein Wäschetrockner.

### [dishwasher]
Eine Spülmaschine.

### [freezer]
Ein Gefrierschrank.

### [fridge]
Ein Kühlschrank.

### [microwave]
Ein Mikrowellengerät.

### [door_lock]
Ein elektrisches Türschloss oder ein Türöffner.

### [ev]
Ein Ladepunkt für ein Elektroauto, an einem eigenen Stromkreis.

### [motor]
Ein Elektromotor, etwa für ein Tor, eine Pumpe oder einen Rollladen.

### [fixed_appliance_generic]
Das allgemeine Symbol für ein festes Gerät, das nicht in dieser Liste steht. Schreiben Sie den Gerätenamen daneben.

## [hvac] Heizung, Warmwasser und Lüftung
Warmwasserbereiter, Heizung, Wärmepumpen und Lüftung.

### [boiler]
Ein elektrischer Warmwasserbereiter, mit einer Variante als Speicher.

### [heating]
Ein elektrisches Heizgerät, etwa ein Konvektor. Es gibt Varianten mit Speicher und mit eingebautem Lüfter.

### [ventilation]
Ein Ventilator oder Lüftungsgerät, etwa eine Lüftungsanlage mit Wärmerückgewinnung.

### [furnace_heatpump]
Eine Wärmepumpe.

### [furnace_gas]
Ein Gaskessel. Elektrisch geht es um die Versorgung von Brenner, Pumpe und Regelung.

### [furnace_oil]
Ein Ölkessel.

### [furnace_pellets]
Ein Pelletofen.

### [furnace]
Eine allgemeine Wärmequelle, mit Varianten für den Energieträger (Strom, Gas, flüssiger oder fester Brennstoff) und den Typ.

## [sound] Signalgeber
Geräte, die ein akustisches Signal geben.

### [buzzer]
Ein Summer.

### [bell]
Eine Klingel, etwa die Türklingel.

### [horn]
Ein Horn.

### [siren]
Eine Sirene, etwa einer Alarmanlage.

## [domotica] Smart Home
Intelligente Steuerung von Beleuchtung, Steckdosen und anderen Stromkreisen.

### [domotica]
Eine Smart-Home-Steuerung wird als zweiteiliges Rechteck gezeichnet: unten das Grundsymbol, etwa ein Schalter oder eine Steckdose, oben die Art der Steuerung. Es gibt Varianten für programmierbare, Funk-, Melder- und Tastersteuerung.

## [metering] Messung
Zähler, die Verbrauch oder Erzeugung erfassen.

### [energy_meter]
Ein kWh-Zähler, für den Zähler des Netzbetreibers oder einen Zwischenzähler, etwa für einen Ladepunkt.

## [energyConversion] Quellen und Umwandlung
Solarmodule, Batterien und Geräte, die Spannung oder Stromart umwandeln. Die Kenndaten einer Quelle geben Sie im Stromlaufplan oder in der Anlagendokumentation an.

### [transformer]
Ein Transformator, etwa ein Klingeltransformator oder Trenntransformator. Es gibt Varianten für Sicherheits- und kurzschlussfeste Transformatoren.

### [rectifier]
Ein Gleichrichter wandelt Wechselstrom in Gleichstrom um.

### [inverter]
Ein Wechselrichter wandelt den Gleichstrom von Solarmodulen oder einer Batterie in Wechselstrom um.

### [dc_dc_converter]
Ein DC/DC-Wandler, auch Gleichstromsteller genannt, setzt eine Gleichspannung auf ein anderes Niveau um.

### [solar_panel]
Ein Photovoltaikmodul oder ein Modulstrang. Geben Sie die Anzahl der Module und die Spitzenleistung an.

### [battery]
Ein Heimspeicher oder anderer Energiespeicher.

### [dc_bus]
Eine DC-Schiene: eine gemeinsame Gleichstromverbindung für Module, Batterie und Wechselrichter.
