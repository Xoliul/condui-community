---
title: Symbole do schematu jednokreskowego i planu rozmieszczenia
description: Symbole elektryczne do belgijskiego schematu jednokreskowego i planu rozmieszczenia z krótkim opisem każdego symbolu, od gniazda i łącznika schodowego po wyłącznik różnicowoprądowy i złącze kontrolne uziemienia.
updated: 2026-11-04
---

Poniżej znajdziesz symbole elektryczne, które występują na belgijskim schemacie jednokreskowym (eendraadschema) i planie rozmieszczenia, z krótkim opisem każdego z nich. Większość odpowiada tabeli 2.23 belgijskiego AREI, Księga 1 (rozdział 2.13), która jest listą otwartą. Dla elementów, których tam brakuje, na przykład magazynu energii lub ogranicznika przepięć, {{brand}} używa własnego symbolu.

Kliknij symbol, aby zobaczyć jego warianty i link do powiązanego wyjaśnienia.

:::condui title="Przydatne w Condui"
Nie musisz rysować tych symboli samodzielnie. W Condui wybierasz urządzenie, a właściwy symbol pojawia się na schemacie jednokreskowym i planie rozmieszczenia.
:::

## [grid] Sieć i uziemienie
Miejsce, w którym prąd wchodzi do budynku, uziemienie oraz puszki i skrzynki, w których spotykają się przewody.

### [mains]
Punkt wyjścia schematu jednokreskowego: zasilanie z sieci dystrybucyjnej. Podaj liczbę faz i napięcie, na przykład 1N 230 V, 3 × 230 V lub 3N 400 V.

### [backup_feed]
Drugie źródło zasilania, na przykład agregat lub wyjście awaryjne falownika hybrydowego.

### [earthing]
Uziom instalacji, zwykle uziom fundamentowy lub szpila uziemiająca. Zapisz zmierzoną rezystancję uziemienia.

### [earthing_separator]
Złącze kontrolne oddziela przewód uziemiający od głównego zacisku uziemiającego, aby można było zmierzyć rezystancję uziomu.

### [panel_distribution]
Rozdzielnica, w której wyłączniki nadprądowe i różnicowoprądowe zasilają obwody. Na planie rozmieszczenia pokazuje, gdzie wisi rozdzielnica.

### [junction_box]
Puszka połączeniowa lub rozgałęźna, w której przewody są łączone lub rozgałęziane.

### [junction_panel]
Skrzynka rozgałęźna: większa obudowa, w której łączy się lub rozdziela kilka przewodów, bez urządzeń zabezpieczających.

### [terminal_strip]
Listwa zaciskowa, rząd zacisków do łączenia przewodów, na przykład w rozdzielnicy lub szafie technicznej.

## [protection] Urządzenia zabezpieczające
Urządzenia, które wyłączają obwód przy przeciążeniu, zwarciu, prądzie upływu lub przepięciu.

### [mcb]
Wyłącznik nadprądowy chroni obwód przed przeciążeniem i zwarciem. Podaj liczbę biegunów, prąd znamionowy i charakterystykę, na przykład 2P 20 A krzywa C.

### [rcd]
Wyłącznik różnicowoprądowy wyłącza, gdy prąd upływa do ziemi. Podaj czułość, typ i prąd znamionowy, na przykład 300 mA typ A 40 A.

### [rcbo]
Wyłącznik różnicowo-nadprądowy łączy wyłącznik nadprądowy i różnicowoprądowy w jednym aparacie dla jednego obwodu. Podaj wartości obu.

### [fuse]
Bezpiecznik topikowy chroni przed przetężeniem, przepalając się. Podaj prąd i typ, na przykład 16 A gG.

### [spd]
Ogranicznik przepięć odprowadza do ziemi krótkie skoki napięcia, na przykład po pobliskim uderzeniu pioruna.

### [rotating_switch]
Łącznik obrotowy z kilkoma położeniami, na przykład jako wyłącznik serwisowy przy pompie ciepła lub do wyboru trybu pracy.

### [source_changeover]
Przełącznik źródeł wybiera jedno z dwóch zasileń, na przykład sieć lub agregat, tak aby nigdy nie były podłączone jednocześnie.

## [outlets] Gniazda wtyczkowe
Gniazda i ich warianty. Symbol pokazuje uziemienie i zabezpieczenie przed dziećmi.

### [socket_gnd_child]
Typowe gniazdo w belgijskim domu: z bolcem uziemiającym i zabezpieczeniem przed dziećmi.

### [double_socket_gnd_child]
Dwa gniazda z bolcem uziemiającym i zabezpieczeniem przed dziećmi w jednej puszce podtynkowej.

### [socket_child]
Gniazdo z zabezpieczeniem przed dziećmi, ale bez bolca uziemiającego, spotykane jeszcze w starszych instalacjach.

### [double_socket_child]
Dwa gniazda z zabezpieczeniem przed dziećmi, bez bolca uziemiającego, w jednej puszce podtynkowej.

### [modular_socket]
Gniazdo modułowe na szynie DIN w rozdzielnicy, na przykład do zasilania routera lub modułu automatyki domowej.

### [socket_gnd]
Gniazdo z bolcem uziemiającym, bez zabezpieczenia przed dziećmi.

### [socket]
Ogólny symbol gniazda wtyczkowego. Uziemienie, zabezpieczenie przed dziećmi lub łącznik dodasz przez warianty.

## [switches] Łączniki i sterowanie
Wszystko, czym sterujesz obwodem lub urządzeniem, od zwykłego łącznika po przekaźnik.

### [switch]
Zwykły łącznik włącza i wyłącza punkt świetlny lub urządzenie z jednego miejsca. Są warianty 1-, 2-, 3- lub 4-biegunowe oraz z lampką kontrolną.

### [switch_1p_twoway]
Łącznik schodowy steruje punktem świetlnym z dwóch miejsc, na przykład na dole i na górze schodów.

### [switch_cross]
Łącznik krzyżowy montuje się między dwoma łącznikami schodowymi, aby sterować z trzech lub więcej miejsc, na przykład w długim korytarzu.

### [switch_dimmer]
Ściemniacz reguluje jasność punktu świetlnego.

### [switch_1p_changeover]
Łącznik świecznikowy steruje dwoma obwodami osobno z jednego miejsca, na przykład lampą sufitową i reflektorkami w salonie.

### [switch_shutter]
Łącznik roletowy steruje podnoszeniem i opuszczaniem rolety lub żaluzji. Napędzający silnik należy przedstawić jako osobne urządzenie.

### [switch_1p_pull]
Łącznik pociągany obsługuje się sznurkiem, głównie w starszych łazienkach.

### [contact]
Osobny styk, na przykład kontaktron drzwiowy lub wejście systemu automatyki domowej.

### [switch_impulse]
Przycisk wysyła krótki impuls do przekaźnika bistabilnego lub wejścia automatyki, zamiast bezpośrednio przełączać obwód.

### [light_sensor]
Wyłącznik zmierzchowy automatycznie włącza oświetlenie, gdy natężenie światła otoczenia spada poniżej ustawionego progu. Dwie strzałki skierowane w stronę styku wskazują, że reaguje on na światło. Jest to wyłącznik sterowany światłem, a nie czujnik ruchu.

### [motion_detector]
Czujnik ruchu automatycznie włącza światło po wykryciu ruchu. Możesz podać technologię: IR, radar lub kombinację.

### [smoke_detector]
Czujka dymu zasilana z sieci, ewentualnie połączona z innymi czujkami.

### [relay]
Przekaźnik lub przekaźnik bistabilny w rozdzielnicy przełącza obwód na sygnał sterujący. Są warianty: czasowy, zegar sterujący, impulsowy, termostat i ściemniacz.

## [lighting] Oświetlenie
Punkty świetlne i oprawy, które rysujesz na planie rozmieszczenia w każdym pomieszczeniu.

### [light_point]
Punkt świetlny to miejsce przyłączenia oprawy na suficie lub ścianie. Są warianty dla oświetlenia awaryjnego i z wbudowanym łącznikiem.

### [light_spot]
Reflektor lub projektor z ukierunkowaną wiązką, z wariantami dla wiązki wąskiej i rozbieżnej.

### [light_led]
Oprawa LED, na przykład panel lub taśma LED.

### [light_fluorescent]
Oprawa fluorescencyjna lub świetlówka.

## [appliances] Urządzenia stałe
Sprzęt AGD i inne odbiorniki stałe. Schemat pokazuje dzięki temu, na którym obwodzie jest każde urządzenie.

### [stove]
Kuchnia elektryczna lub płyta grzewcza, zwykle na osobnym obwodzie.

### [oven]
Piekarnik elektryczny.

### [washer]
Pralka.

### [dryer]
Suszarka bębnowa.

### [dishwasher]
Zmywarka.

### [freezer]
Zamrażarka.

### [fridge]
Lodówka.

### [microwave]
Kuchenka mikrofalowa.

### [door_lock]
Zamek elektryczny lub elektrozaczep.

### [ev]
Punkt ładowania samochodu elektrycznego, na osobnym obwodzie.

### [motor]
Silnik elektryczny, na przykład bramy, pompy lub rolety.

### [fixed_appliance_generic]
Ogólny symbol urządzenia stałego, którego nie ma na tej liście. Dopisz obok nazwę urządzenia.

## [hvac] Ogrzewanie, ciepła woda i wentylacja
Podgrzewacze wody, ogrzewanie, pompy ciepła i wentylacja.

### [boiler]
Elektryczny podgrzewacz wody, z wariantem pojemnościowym.

### [heating]
Elektryczne urządzenie grzewcze, na przykład konwektor. Są warianty akumulacyjne i z wbudowanym wentylatorem.

### [ventilation]
Wentylator lub centrala wentylacyjna, na przykład wentylacja mechaniczna z odzyskiem ciepła.

### [furnace_heatpump]
Pompa ciepła.

### [furnace_gas]
Kocioł gazowy. Elektrycznie chodzi o zasilanie palnika, pompy i sterowania.

### [furnace_oil]
Kocioł olejowy.

### [furnace_pellets]
Piec na pellet.

### [furnace]
Ogólne źródło ciepła, z wariantami dla nośnika energii (prąd, gaz, paliwo ciekłe lub stałe) i typu.

## [sound] Sygnalizacja
Urządzenia, które dają sygnał dźwiękowy.

### [buzzer]
Brzęczyk.

### [bell]
Dzwonek, na przykład do drzwi.

### [horn]
Sygnalizator dźwiękowy (tuba).

### [siren]
Syrena, na przykład systemu alarmowego.

## [domotica] Automatyka domowa
Inteligentne sterowanie oświetleniem, gniazdami i innymi obwodami.

### [domotica]
Sterownik automatyki rysuje się jako prostokąt z dwóch części: na dole symbol podstawowy, na przykład łącznik lub gniazdo, na górze rodzaj sterowania. Są warianty sterowania programowalnego, bezprzewodowego, czujnikowego i przyciskowego.

## [metering] Pomiar
Liczniki, które rejestrują zużycie lub produkcję.

### [energy_meter]
Licznik kWh, dla licznika operatora sieci lub podlicznika, na przykład dla punktu ładowania.

## [energyConversion] Źródła i przetwarzanie
Panele słoneczne, baterie i urządzenia, które zmieniają napięcie lub rodzaj prądu. Parametry źródła podaj na schemacie jednokreskowym lub w dokumentacji instalacji.

### [transformer]
Transformator, na przykład dzwonkowy lub separacyjny. Są warianty dla transformatorów bezpieczeństwa i zwarciowo odpornych.

### [rectifier]
Prostownik zamienia prąd przemienny na stały.

### [inverter]
Falownik zamienia prąd stały z paneli słonecznych lub baterii na prąd przemienny.

### [dc_dc_converter]
Przetwornica DC/DC, zwana też przerywaczem, zmienia napięcie stałe na inny poziom.

### [solar_panel]
Panel fotowoltaiczny lub łańcuch paneli. Podaj liczbę paneli i moc szczytową.

### [battery]
Domowy magazyn energii lub inny akumulator.

### [dc_bus]
Szyna DC: wspólne połączenie prądu stałego dla paneli, baterii i falownika.
