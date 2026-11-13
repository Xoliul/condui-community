---
title: Symboles pour schéma unifilaire et plan de situation
description: Symboles électriques pour votre schéma unifilaire et plan de situation avec une courte explication par symbole, de la prise et l'interrupteur va-et-vient au différentiel et à la barrette de coupure.
updated: 2026-11-04
---

Voici les symboles électriques que vous rencontrez sur un schéma unifilaire et un plan de situation, avec une courte explication par symbole. La plupart correspondent au tableau 2.23 du RGIE Livre 1 (chapitre 2.13), une liste non limitative. Pour les éléments qui n'y figurent pas, comme une batterie domestique ou un parafoudre, {{brand}} utilise son propre symbole.

Cliquez sur un symbole pour voir ses variantes et un lien vers l'explication correspondante.

:::condui title="Utile dans Condui"
Vous ne devez pas dessiner ces symboles vous-même. Dans Condui, vous choisissez un appareil et le bon symbole apparaît sur votre schéma unifilaire et votre plan de situation.
:::

## [grid] Réseau et mise à la terre
L'arrivée du courant dans l'habitation, la mise à la terre et les boîtes et coffrets où les canalisations se rejoignent.

### [mains]
Le point de départ de votre schéma unifilaire : l'alimentation depuis le réseau de distribution. Indiquez le nombre de phases et la tension, par exemple 1N 230 V, 3 × 230 V ou 3N 400 V.

### [backup_feed]
Une deuxième source d'alimentation, comme un groupe électrogène ou la sortie de secours d'un onduleur hybride.

### [earthing]
La prise de terre de l'installation, généralement une boucle de terre sous les fondations ou un piquet de terre. Notez la résistance de dispersion mesurée.

### [earthing_separator]
La barrette de coupure sépare le conducteur de terre de la borne principale de terre, pour mesurer la résistance de dispersion de la prise de terre.

### [panel_distribution]
Le tableau de répartition et de distribution où disjoncteurs et différentiels alimentent les circuits. Sur le plan de situation, il montre l'emplacement du tableau.

### [junction_box]
Une boîte de connexion ou de dérivation où les canalisations sont raccordées ou dérivées.

### [junction_panel]
Un coffret de dérivation : un coffret plus grand où plusieurs canalisations sont raccordées ou réparties, sans appareils de protection.

### [terminal_strip]
Un bornier, une rangée de bornes où les conducteurs sont raccordés, par exemple dans un tableau ou une armoire technique.

## [protection] Appareils de protection
Appareils qui coupent un circuit en cas de surcharge, de court-circuit, de courant de fuite ou de surtension.

### [mcb]
Un disjoncteur protège un circuit contre les surcharges et les courts-circuits. Indiquez les pôles, le courant nominal et la courbe, par exemple 2P 20 A courbe C.

### [rcd]
Un différentiel coupe dès qu'un courant fuit vers la terre. Indiquez la sensibilité, le type et le courant nominal, par exemple 300 mA type A 40 A.

### [rcbo]
Un disjoncteur différentiel combine disjoncteur et différentiel dans un seul appareil pour un circuit. Indiquez les valeurs des deux.

### [fuse]
Un fusible protège contre les surintensités en fondant. Indiquez le courant et le type, par exemple 16 A gG.

### [spd]
Un parafoudre dérive vers la terre les pics de tension brefs, par exemple dus à un coup de foudre à proximité.

### [rotating_switch]
Un commutateur rotatif à plusieurs positions, par exemple comme interrupteur de proximité d'une pompe à chaleur ou pour choisir un mode de fonctionnement.

### [source_changeover]
Un inverseur de source choisit entre deux alimentations, par exemple réseau et groupe électrogène, pour qu'elles ne soient jamais raccordées en même temps.

## [outlets] Prises de courant
Les prises et leurs variantes. Le symbole montre la terre et la sécurité enfant.

### [socket_gnd_child]
La prise habituelle d'une habitation belge : avec broche de terre et sécurité enfant.

### [double_socket_gnd_child]
Deux prises avec broche de terre et sécurité enfant dans une seule boîte d'encastrement.

### [socket_child]
Une prise avec sécurité enfant mais sans broche de terre, comme on en trouve encore dans les anciennes installations.

### [double_socket_child]
Deux prises avec sécurité enfant, sans broche de terre, dans une seule boîte d'encastrement.

### [modular_socket]
Une prise modulaire sur rail DIN dans le tableau, par exemple pour alimenter un routeur ou un module domotique.

### [socket_gnd]
Une prise avec broche de terre, sans sécurité enfant.

### [socket]
Le symbole général d'une prise de courant. Ajoutez la terre, la sécurité enfant ou un interrupteur avec les variantes.

## [switches] Interrupteurs et commandes
Tout ce qui commande un circuit ou un appareil, de l'interrupteur simple au relais.

### [switch]
Un interrupteur simple allume et éteint un point lumineux ou un appareil depuis un seul endroit. Il existe des variantes à 1, 2, 3 ou 4 pôles et avec voyant.

### [switch_1p_twoway]
Un interrupteur va-et-vient commande un point lumineux depuis deux endroits, par exemple en bas et en haut de l'escalier.

### [switch_cross]
Un permutateur se place entre deux va-et-vient pour commander depuis trois endroits ou plus, par exemple dans un long couloir.

### [switch_dimmer]
Un variateur règle l'intensité d'un point lumineux.

### [switch_1p_changeover]
Un interrupteur double allumage commande deux circuits séparément depuis un seul endroit, par exemple le plafonnier et les spots du séjour.

### [switch_shutter]
Un interrupteur de volet roulant commande la montée et la descente d’un volet ou d’un store. Représentez le moteur entraîné comme un appareil distinct.

### [switch_1p_pull]
Un interrupteur à tirette s'actionne avec un cordon, surtout dans les anciennes salles de bain.

### [contact]
Un contact séparé, par exemple un contact de porte ou une entrée d'un système domotique.

### [switch_impulse]
Un bouton-poussoir envoie une brève impulsion à un télérupteur ou une entrée domotique au lieu de commuter le circuit directement.

### [light_sensor]
Un interrupteur crépusculaire allume automatiquement l’éclairage lorsque la luminosité ambiante descend sous le seuil réglé. Les deux flèches vers le contact indiquent qu’il réagit à la lumière. Il s’agit d’un interrupteur commandé par la lumière, pas d’un détecteur de mouvement.

### [motion_detector]
Un détecteur de mouvement allume l'éclairage automatiquement en cas de mouvement. Vous pouvez indiquer la technologie : IR, radar ou combinaison.

### [smoke_detector]
Un détecteur de fumée raccordé au réseau, éventuellement relié à d'autres détecteurs.

### [relay]
Un relais ou télérupteur dans le tableau commute un circuit sur un signal de commande. Il existe des variantes minuterie, horloge, impulsion, thermostat et variateur.

## [lighting] Éclairage
Points lumineux et luminaires, tels que vous les dessinez par pièce sur le plan de situation.

### [light_point]
Un point lumineux est le point de raccordement d'un luminaire au plafond ou au mur. Il existe des variantes pour l'éclairage de sécurité et avec interrupteur intégré.

### [light_spot]
Un spot ou projecteur à faisceau dirigé, avec des variantes à faisceau peu divergent et divergent.

### [light_led]
Un luminaire LED, par exemple un panneau ou un ruban LED.

### [light_fluorescent]
Un luminaire fluorescent ou tube TL.

## [appliances] Appareils fixes
Électroménagers et autres récepteurs fixes. Le schéma montre ainsi sur quel circuit se trouve chaque appareil.

### [stove]
Une cuisinière électrique ou une table de cuisson, généralement sur un circuit propre.

### [oven]
Un four électrique.

### [washer]
Un lave-linge.

### [dryer]
Un sèche-linge.

### [dishwasher]
Un lave-vaisselle.

### [freezer]
Un congélateur.

### [fridge]
Un réfrigérateur.

### [microwave]
Un four à micro-ondes.

### [door_lock]
Une serrure électrique ou une gâche électrique.

### [ev]
Un point de recharge pour voiture électrique, sur un circuit propre.

### [motor]
Un moteur électrique, par exemple d'une porte, d'une pompe ou d'un volet roulant.

### [fixed_appliance_generic]
Le symbole général d'un appareil fixe absent de cette liste. Écrivez le nom de l'appareil à côté.

## [hvac] Chauffage, eau chaude et ventilation
Chauffe-eau, chauffage, pompes à chaleur et ventilation.

### [boiler]
Un chauffe-eau électrique, avec une variante à accumulation.

### [heating]
Un appareil de chauffage électrique, comme un convecteur. Il existe des variantes à accumulation et avec ventilateur intégré.

### [ventilation]
Un ventilateur ou une unité de ventilation, par exemple un système de ventilation D.

### [furnace_heatpump]
Une pompe à chaleur.

### [furnace_gas]
Une chaudière au gaz. Électriquement, il s'agit de l'alimentation du brûleur, de la pompe et de la régulation.

### [furnace_oil]
Une chaudière au mazout.

### [furnace_pellets]
Un poêle à pellets.

### [furnace]
Une source de chaleur générale, avec des variantes pour la source d'énergie (électricité, gaz, combustible liquide ou solide) et le type.

## [sound] Signalisation
Appareils qui émettent un signal sonore.

### [buzzer]
Un ronfleur.

### [bell]
Une sonnerie, par exemple la sonnette.

### [horn]
Un avertisseur sonore.

### [siren]
Une sirène, par exemple d'un système d'alarme.

## [domotica] Domotique
Commande intelligente de l'éclairage, des prises et d'autres circuits.

### [domotica]
Une commande domotique se dessine comme un rectangle en deux parties : en bas le symbole de base, comme un interrupteur ou une prise, en haut le type de commande. Il existe des variantes programmable, sans fil, par détection et par bouton-poussoir.

## [metering] Comptage
Compteurs qui enregistrent la consommation ou la production.

### [energy_meter]
Un compteur kWh, pour le compteur du gestionnaire de réseau ou un compteur intermédiaire, par exemple pour une borne de recharge.

## [energyConversion] Sources et conversion
Panneaux solaires, batteries et appareils qui convertissent la tension ou la nature du courant. Indiquez les caractéristiques d'une source sur le schéma unifilaire ou dans le dossier.

### [transformer]
Un transformateur, par exemple un transformateur de sonnerie ou de séparation. Il existe des variantes pour transformateurs de sécurité et résistants aux courts-circuits.

### [rectifier]
Un redresseur convertit le courant alternatif en courant continu.

### [inverter]
Un onduleur convertit le courant continu des panneaux solaires ou d'une batterie en courant alternatif.

### [dc_dc_converter]
Un convertisseur DC/DC, aussi appelé hacheur, convertit une tension continue vers un autre niveau.

### [solar_panel]
Un panneau photovoltaïque ou une chaîne de panneaux. Indiquez le nombre de panneaux et la puissance crête.

### [battery]
Une batterie domestique ou un autre stockage d'énergie.

### [dc_bus]
Un rail DC : une liaison commune en courant continu pour panneaux, batterie et onduleur.
