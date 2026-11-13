---
title: Symbolen voor eendraadschema en situatieplan
description: Elektrische symbolen voor je eendraadschema en situatieplan met korte uitleg per symbool, van stopcontact en wisselschakelaar tot differentieel en aardingsonderbreker.
updated: 2026-11-04
---

Hieronder staan de elektrische symbolen die je op een eendraadschema en situatieplan tegenkomt, met een korte uitleg per symbool. De meeste komen overeen met tabel 2.23 van AREI Boek 1 (hoofdstuk 2.13), een niet-limitatieve lijst. Voor onderdelen die daar ontbreken, zoals een thuisbatterij of een overspanningsbeveiliging, gebruikt {{brand}} een eigen symbool.

Klik op een symbool voor de varianten en een link naar de bijhorende uitleg.

:::condui title="Handig met Condui"
Je hoeft deze symbolen niet zelf te tekenen. In Condui kies je een toestel, en het juiste symbool komt op je eendraadschema en situatieplan.
:::

## [grid] Net en aarding
Waar de stroom de woning binnenkomt, de aarding en de kasten en dozen waarin leidingen samenkomen.

### [mains]
Het vertrekpunt van je eendraadschema: de voeding vanuit het distributienet. Vermeld het aantal fasen en de spanning, bijvoorbeeld 1N 230 V, 3 × 230 V of 3N 400 V.

### [backup_feed]
Een tweede voedingsbron, zoals een generator of de noodstroomuitgang van een hybride omvormer.

### [earthing]
De aardelektrode van de installatie, meestal een aardlus onder de fundering of een aardpen. Noteer de gemeten spreidingsweerstand.

### [earthing_separator]
De aardingsonderbreker scheidt de aardleiding van de hoofdaardingsklem, zodat je de spreidingsweerstand van de aardelektrode kunt meten.

### [panel_distribution]
Het schakel- en verdeelbord waarin automaten en differentiëlen de kringen voeden. Op het situatieplan toont het waar de kast hangt.

### [junction_box]
Een verbindingsdoos of aftakdoos waarin leidingen verbonden of afgetakt worden.

### [junction_panel]
Een aftakkast: een grotere kast waarin meerdere leidingen verbonden of verdeeld worden, zonder beveiligingen.

### [terminal_strip]
Een klemmenstrook, een rij aansluitklemmen waarop geleiders worden doorverbonden, bijvoorbeeld in een verdeelbord of technische kast.

## [protection] Beveiligingstoestellen
Toestellen die een kring afschakelen bij overbelasting, kortsluiting, lekstroom of overspanning.

### [mcb]
Een automaat beschermt een kring tegen overbelasting en kortsluiting. Vermeld polen, nominale stroom en curve, bijvoorbeeld 2P 20 A curve C.

### [rcd]
Een differentieel schakelt af zodra er stroom naar de aarde weglekt. Vermeld gevoeligheid, type en nominale stroom, bijvoorbeeld 300 mA type A 40 A.

### [rcbo]
Een differentieelautomaat combineert automaat en differentieel in één toestel voor één kring. Vermeld de waarden van beide.

### [fuse]
Een smeltzekering beschermt tegen overstroom door door te smelten. Vermeld stroom en type, bijvoorbeeld 16 A gG.

### [spd]
Een overspanningsbeveiliging leidt korte spanningspieken, bijvoorbeeld door een blikseminslag in de buurt, af naar de aarding.

### [rotating_switch]
Een draaischakelaar met meerdere standen, bijvoorbeeld als werkschakelaar bij een warmtepomp of om tussen bedrijfsstanden te kiezen.

### [source_changeover]
Een bronomschakelaar kiest tussen twee voedingen, bijvoorbeeld net en generator, zodat ze nooit samen op de installatie staan.

## [outlets] Contactdozen
Stopcontacten en hun varianten. Aarding en kinderbeveiliging zie je aan het symbool.

### [socket_gnd_child]
Het gewone stopcontact in een Belgische woning: met aardingspen en kinderbeveiliging.

### [double_socket_gnd_child]
Twee stopcontacten met aardingspen en kinderbeveiliging in één inbouwdoos.

### [socket_child]
Een stopcontact met kinderbeveiliging maar zonder aardingspen, zoals je het nog in oudere installaties vindt.

### [double_socket_child]
Twee stopcontacten met kinderbeveiliging, zonder aardingspen, in één inbouwdoos.

### [modular_socket]
Een modulair stopcontact op de DIN-rail in het verdeelbord, bijvoorbeeld voor de voeding van een router of domoticamodule.

### [socket_gnd]
Een stopcontact met aardingspen, zonder kinderbeveiliging.

### [socket]
Het algemene symbool voor een stopcontact. Aarding, kinderbeveiliging of een schakelaar voeg je toe met de varianten.

## [switches] Schakelaars en bediening
Alles waarmee je een kring of toestel bedient, van gewone schakelaar tot relais.

### [switch]
Een gewone schakelaar zet een lichtpunt of toestel aan en uit vanaf één plaats. Er zijn varianten voor 1, 2, 3 of 4 polen en met verklikkerlamp.

### [switch_1p_twoway]
Een wisselschakelaar bedient een lichtpunt vanaf twee plaatsen, bijvoorbeeld onderaan en bovenaan de trap.

### [switch_cross]
Een kruisschakelaar komt tussen twee wisselschakelaars, zodat je vanaf drie of meer plaatsen schakelt, bijvoorbeeld in een lange gang.

### [switch_dimmer]
Een dimmer regelt de lichtsterkte van een lichtpunt.

### [switch_1p_changeover]
Een omschakelaar, ook dubbele aansteking, bedient twee kringen apart vanaf één plaats, bijvoorbeeld plafondlicht en spots in de living.

### [switch_shutter]
Een rolluikschakelaar bedient de op- en neergaande beweging van een rolluik of zonwering. Teken de aangedreven motor als afzonderlijk toestel.

### [switch_1p_pull]
Een trekschakelaar bedien je met een koord, een oplossing die je vooral in oudere badkamers ziet.

### [contact]
Een los contact, bijvoorbeeld een deurcontact of een ingang van een domoticasysteem.

### [switch_impulse]
Een drukknop geeft een korte puls aan een teleruptor of domotica-ingang in plaats van de kring rechtstreeks te schakelen.

### [light_sensor]
Een schemerschakelaar schakelt verlichting automatisch in wanneer het omgevingslicht onder de ingestelde drempel daalt. De twee pijlen naar het contact geven aan dat het op licht reageert. Dit is een door licht gestuurde schakelaar, geen bewegingsdetector.

### [motion_detector]
Een bewegingsdetector schakelt licht automatisch bij beweging. Je mag de technologie erbij vermelden: IR, radar of een combinatie.

### [smoke_detector]
Een rookmelder die op het net is aangesloten, eventueel gekoppeld aan andere melders.

### [relay]
Een relais of teleruptor in het verdeelbord schakelt een kring op een stuursignaal. Er zijn varianten voor tijdschakelaar, schakelklok, impuls, thermostaat en dimmer.

## [lighting] Verlichting
Lichtpunten en armaturen, zoals je ze op het situatieplan per ruimte tekent.

### [light_point]
Een lichtpunt is het aansluitpunt voor een verlichtingstoestel op plafond of wand. Er zijn varianten voor veiligheidsverlichting en een ingebouwde schakelaar.

### [light_spot]
Een spot of projector met een gerichte lichtbundel, met varianten voor een weinig divergerende en een divergerende bundel.

### [light_led]
Een LED-armatuur, bijvoorbeeld een LED-paneel of LED-strip.

### [light_fluorescent]
Een fluorescentiearmatuur of TL-buis.

## [appliances] Vaste toestellen
Huishoudtoestellen en andere vaste verbruikers. Zo zie je op het schema op welke kring elk toestel zit.

### [stove]
Een elektrisch fornuis of een kookplaat, meestal op een eigen kring.

### [oven]
Een elektrische oven.

### [washer]
Een wasmachine.

### [dryer]
Een droogkast.

### [dishwasher]
Een vaatwasmachine.

### [freezer]
Een diepvriezer.

### [fridge]
Een koelkast.

### [microwave]
Een microgolfoven.

### [door_lock]
Een elektrisch deurslot of een deuropener.

### [ev]
Een laadpunt voor een elektrische wagen, op een eigen kring.

### [motor]
Een elektrische motor, bijvoorbeeld van een poort, pomp of rolluik.

### [fixed_appliance_generic]
Het algemene symbool voor een vast toestel dat niet in deze lijst staat. Schrijf de naam van het toestel erbij.

## [hvac] Verwarming, sanitair warm water en ventilatie
Boilers, verwarming, warmtepompen en ventilatie.

### [boiler]
Een elektrische boiler, met een variant voor een accumulatieboiler.

### [heating]
Een elektrisch verwarmingstoestel, zoals een convector. Er zijn varianten met accumulatie en met ingebouwde ventilator.

### [ventilation]
Een ventilator of ventilatie-unit, bijvoorbeeld een ventilatiesysteem D.

### [furnace_heatpump]
Een warmtepomp.

### [furnace_gas]
Een gasketel. Elektrisch gaat het om de voeding van brander, pomp en regeling.

### [furnace_oil]
Een stookolieketel.

### [furnace_pellets]
Een pelletkachel.

### [furnace]
Een algemene warmtebron, met varianten voor de energiebron (elektriciteit, gas, vloeibare of vaste brandstof) en het type.

## [sound] Signalisatie
Toestellen die een geluidssignaal geven.

### [buzzer]
Een zoemer.

### [bell]
Een bel, bijvoorbeeld de deurbel.

### [horn]
Een hoorn.

### [siren]
Een sirene, bijvoorbeeld van een alarmsysteem.

## [domotica] Domotica
Slimme sturing van verlichting, stopcontacten en andere kringen.

### [domotica]
Een domotica-sturing teken je als rechthoek in twee delen: onderaan het basissymbool, zoals een schakelaar of stopcontact, bovenaan het type sturing. Er zijn varianten voor programmeerbare, draadloze, detectie- en drukknopsturing.

## [metering] Meting
Meters die het verbruik of de productie registreren.

### [energy_meter]
Een kWh-teller, voor de meter van de netbeheerder of een tussenmeter, bijvoorbeeld voor een laadpaal.

## [energyConversion] Bronnen en omvorming
Zonnepanelen, batterijen en toestellen die spanning of stroomsoort omzetten. De kenmerken van een bron vermeld je op het eendraadschema of in het dossier.

### [transformer]
Een transformator, bijvoorbeeld een beltransformator of een scheidingstransformator. Er zijn varianten voor veiligheids- en kortsluitvaste transformatoren.

### [rectifier]
Een gelijkrichter zet wisselstroom om in gelijkstroom.

### [inverter]
Een omvormer zet de gelijkstroom van zonnepanelen of een batterij om in wisselstroom.

### [dc_dc_converter]
Een DC/DC-omzetter, ook hakker genoemd, zet een gelijkspanning om naar een ander niveau.

### [solar_panel]
Een fotovoltaïsch paneel of een string panelen. Vermeld het aantal panelen en het piekvermogen.

### [battery]
Een thuisbatterij of andere energieopslag.

### [dc_bus]
Een DC-rail: een gemeenschappelijke gelijkstroomverbinding waarop panelen, batterij en omvormer aansluiten.
