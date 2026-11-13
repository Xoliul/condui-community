---
title: Simboluri pentru schema monofilară și planul de poziție
description: Simboluri electrice pentru schema monofilară belgiană și planul de poziție, cu o scurtă explicație pentru fiecare simbol, de la priză și comutator cap-scară la dispozitivul diferențial și piesa de separație a prizei de pământ.
updated: 2026-11-04
---

Mai jos găsești simbolurile electrice care apar pe o schemă monofilară belgiană (eendraadschema) și pe planul de poziție, cu o scurtă explicație pentru fiecare. Cele mai multe corespund tabelului 2.23 din AREI belgian, Cartea 1 (capitolul 2.13), o listă neexhaustivă. Pentru componentele care lipsesc de acolo, de exemplu o baterie de acasă sau un descărcător de supratensiune, {{brand}} folosește un simbol propriu.

Apasă pe un simbol pentru variante și un link către explicația asociată.

:::condui title="Util cu Condui"
Nu trebuie să desenezi singur aceste simboluri. În Condui alegi un aparat, iar simbolul potrivit apare pe schema monofilară și pe planul de poziție.
:::

## [grid] Rețea și împământare
Locul unde curentul intră în casă, împământarea și dozele și cutiile în care se întâlnesc conductoarele.

### [mains]
Punctul de plecare al schemei monofilare: alimentarea din rețeaua de distribuție. Indică numărul de faze și tensiunea, de exemplu 1N 230 V, 3 × 230 V sau 3N 400 V.

### [backup_feed]
O a doua sursă de alimentare, de exemplu un generator sau ieșirea de rezervă a unui invertor hibrid.

### [earthing]
Priza de pământ a instalației, de obicei o buclă de pământ sub fundație sau un electrod vertical. Notează rezistența de dispersie măsurată.

### [earthing_separator]
Piesa de separație desparte conductorul de împământare de borna principală de împământare, ca să poți măsura rezistența prizei de pământ.

### [panel_distribution]
Tabloul de distribuție în care siguranțele automate și dispozitivele diferențiale alimentează circuitele. Pe planul de poziție arată unde se află tabloul.

### [junction_box]
O doză de conexiuni sau de derivație în care conductoarele sunt legate sau derivate.

### [junction_panel]
O cutie de derivație: o carcasă mai mare în care mai multe circuite sunt legate sau distribuite, fără aparate de protecție.

### [terminal_strip]
Un șir de cleme în care se leagă conductoarele, de exemplu într-un tablou sau un dulap tehnic.

## [protection] Aparate de protecție
Aparate care deconectează un circuit la suprasarcină, scurtcircuit, curent de scurgere sau supratensiune.

### [mcb]
O siguranță automată protejează un circuit împotriva suprasarcinii și scurtcircuitului. Indică polii, curentul nominal și curba, de exemplu 2P 20 A curba C.

### [rcd]
Un dispozitiv diferențial deconectează imediat ce curentul se scurge la pământ. Indică sensibilitatea, tipul și curentul nominal, de exemplu 300 mA tip A 40 A.

### [rcbo]
Un întrerupător automat diferențial combină siguranța automată și diferențialul într-un singur aparat pentru un circuit. Indică valorile ambelor.

### [fuse]
O siguranță fuzibilă protejează împotriva supracurentului prin topire. Indică curentul și tipul, de exemplu 16 A gG.

### [spd]
Un descărcător de supratensiune deviază la pământ vârfurile scurte de tensiune, de exemplu de la un trăsnet în apropiere.

### [rotating_switch]
Un comutator rotativ cu mai multe poziții, de exemplu ca separator de serviciu lângă o pompă de căldură sau pentru alegerea unui mod de funcționare.

### [source_changeover]
Un comutator de surse alege între două alimentări, de exemplu rețea și generator, astfel încât să nu fie niciodată conectate simultan.

## [outlets] Prize
Prizele și variantele lor. Simbolul arată împământarea și protecția pentru copii.

### [socket_gnd_child]
Priza obișnuită într-o locuință belgiană: cu pin de împământare și protecție pentru copii.

### [double_socket_gnd_child]
Două prize cu pin de împământare și protecție pentru copii într-o singură doză.

### [socket_child]
O priză cu protecție pentru copii, dar fără pin de împământare, cum se mai găsește în instalațiile vechi.

### [double_socket_child]
Două prize cu protecție pentru copii, fără pin de împământare, într-o singură doză.

### [modular_socket]
O priză modulară pe șina DIN din tablou, de exemplu pentru alimentarea unui router sau a unui modul de automatizare.

### [socket_gnd]
O priză cu pin de împământare, fără protecție pentru copii.

### [socket]
Simbolul general pentru o priză. Împământarea, protecția pentru copii sau un întrerupător le adaugi prin variante.

## [switches] Întrerupătoare și comandă
Tot ce comandă un circuit sau un aparat, de la întrerupătorul simplu la releu.

### [switch]
Un întrerupător simplu aprinde și stinge un punct de iluminat sau un aparat dintr-un singur loc. Există variante cu 1, 2, 3 sau 4 poli și cu lampă de control.

### [switch_1p_twoway]
Un comutator cap-scară comandă un punct de iluminat din două locuri, de exemplu jos și sus pe scară.

### [switch_cross]
Un comutator cruce se montează între două comutatoare cap-scară, ca să comanzi din trei sau mai multe locuri, de exemplu pe un hol lung.

### [switch_dimmer]
Un variator reglează intensitatea unui punct de iluminat.

### [switch_1p_changeover]
Un comutator dublu comandă separat două circuite dintr-un singur loc, de exemplu plafoniera și spoturile din living.

### [switch_shutter]
Un întrerupător pentru rulouri comandă ridicarea și coborârea unui rulou sau a unei jaluzele. Reprezentați motorul acționat ca aparat separat.

### [switch_1p_pull]
Un întrerupător cu șnur se acționează trăgând de un cordon, mai ales în băile vechi.

### [contact]
Un contact separat, de exemplu un contact de ușă sau o intrare a unui sistem de automatizare.

### [switch_impulse]
Un buton trimite un impuls scurt către un releu de impuls sau o intrare de automatizare, în loc să comute direct circuitul.

### [light_sensor]
Un întrerupător crepuscular aprinde automat iluminatul când lumina ambiantă scade sub pragul setat. Cele două săgeți spre contact indică faptul că acesta reacționează la lumină. Este un întrerupător comandat de lumină, nu un detector de mișcare.

### [motion_detector]
Un detector de mișcare aprinde automat lumina la mișcare. Poți indica tehnologia: IR, radar sau o combinație.

### [smoke_detector]
Un detector de fum alimentat de la rețea, eventual legat de alte detectoare.

### [relay]
Un releu sau releu de impuls din tablou comută un circuit la un semnal de comandă. Există variante pentru temporizator, ceas programator, impuls, termostat și variator.

## [lighting] Iluminat
Puncte de iluminat și corpuri de iluminat, așa cum le desenezi pe planul de poziție în fiecare cameră.

### [light_point]
Un punct de iluminat este punctul de racord pentru un corp de iluminat pe tavan sau perete. Există variante pentru iluminat de siguranță și cu întrerupător încorporat.

### [light_spot]
Un spot sau proiector cu fascicul dirijat, cu variante pentru fascicul îngust și divergent.

### [light_led]
Un corp de iluminat LED, de exemplu un panou sau o bandă LED.

### [light_fluorescent]
Un corp de iluminat fluorescent sau un tub fluorescent.

## [appliances] Aparate fixe
Electrocasnice și alți consumatori ficși. Schema arată astfel pe ce circuit se află fiecare aparat.

### [stove]
O mașină de gătit electrică sau o plită, de obicei pe un circuit propriu.

### [oven]
Un cuptor electric.

### [washer]
O mașină de spălat rufe.

### [dryer]
Un uscător de rufe.

### [dishwasher]
O mașină de spălat vase.

### [freezer]
Un congelator.

### [fridge]
Un frigider.

### [microwave]
Un cuptor cu microunde.

### [door_lock]
O încuietoare electrică sau un deschizător de ușă.

### [ev]
Un punct de încărcare pentru o mașină electrică, pe un circuit propriu.

### [motor]
Un motor electric, de exemplu al unei porți, pompe sau rulouri.

### [fixed_appliance_generic]
Simbolul general pentru un aparat fix care nu apare în această listă. Scrie numele aparatului alături.

## [hvac] Încălzire, apă caldă și ventilație
Boilere, încălzire, pompe de căldură și ventilație.

### [boiler]
Un boiler electric, cu o variantă cu acumulare.

### [heating]
Un aparat electric de încălzire, de exemplu un convector. Există variante cu acumulare și cu ventilator încorporat.

### [ventilation]
Un ventilator sau o unitate de ventilație, de exemplu ventilație mecanică cu recuperare de căldură.

### [furnace_heatpump]
O pompă de căldură.

### [furnace_gas]
O centrală pe gaz. Electric, este vorba de alimentarea arzătorului, pompei și automatizării.

### [furnace_oil]
O centrală pe motorină.

### [furnace_pellets]
O sobă pe peleți.

### [furnace]
O sursă generală de căldură, cu variante pentru sursa de energie (electricitate, gaz, combustibil lichid sau solid) și tip.

## [sound] Semnalizare
Aparate care emit un semnal sonor.

### [buzzer]
Un buzzer.

### [bell]
O sonerie, de exemplu soneria de la ușă.

### [horn]
O hupă.

### [siren]
O sirenă, de exemplu a unui sistem de alarmă.

## [domotica] Automatizarea locuinței
Comanda inteligentă a iluminatului, prizelor și altor circuite.

### [domotica]
O comandă de automatizare se desenează ca un dreptunghi în două părți: jos simbolul de bază, de exemplu un întrerupător sau o priză, sus tipul de comandă. Există variante pentru comandă programabilă, fără fir, prin detecție și prin buton.

## [metering] Măsurare
Contoare care înregistrează consumul sau producția.

### [energy_meter]
Un contor kWh, pentru contorul operatorului de rețea sau un contor intermediar, de exemplu pentru un punct de încărcare.

## [energyConversion] Surse și conversie
Panouri solare, baterii și aparate care schimbă tensiunea sau felul curentului. Caracteristicile unei surse le indici pe schema monofilară sau în dosarul instalației.

### [transformer]
Un transformator, de exemplu de sonerie sau de separare. Există variante pentru transformatoare de siguranță și rezistente la scurtcircuit.

### [rectifier]
Un redresor transformă curentul alternativ în curent continuu.

### [inverter]
Un invertor transformă curentul continuu de la panouri solare sau de la o baterie în curent alternativ.

### [dc_dc_converter]
Un convertor DC/DC, numit și chopper, transformă o tensiune continuă la alt nivel.

### [solar_panel]
Un panou fotovoltaic sau un șir de panouri. Indică numărul de panouri și puterea de vârf.

### [battery]
O baterie de acasă sau alt sistem de stocare a energiei.

### [dc_bus]
O bară DC: o legătură comună în curent continuu pentru panouri, baterie și invertor.
