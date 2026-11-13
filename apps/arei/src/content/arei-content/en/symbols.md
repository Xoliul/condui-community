---
title: Symbols for one-line diagrams and situation plans
description: Electrical symbols for your Belgian one-line diagram and situation plan with a short explanation of each, from socket and two-way switch to RCD and earthing separator.
updated: 2026-11-04
---

Below are the electrical symbols you find on a one-line diagram (eendraadschema) and situation plan, with a short explanation of each. Most match table 2.23 of AREI Book 1 (chapter 2.13), a non-exhaustive list. For components it does not cover, such as a home battery or a surge protection device, {{brand}} uses its own symbol.

Click a symbol to see its variants and a link to the related explanation.

:::condui title="Useful in Condui"
You do not have to draw these symbols yourself. In Condui you pick a device, and the right symbol appears on your one-line diagram and situation plan.
:::

## [grid] Grid and earthing
Where power enters the home, the earthing, and the boxes and enclosures where cables meet.

### [mains]
The starting point of your one-line diagram: the supply from the distribution grid. State the number of phases and the voltage, for example 1N 230 V, 3 × 230 V or 3N 400 V.

### [backup_feed]
A second power source, such as a generator or the backup output of a hybrid inverter.

### [earthing]
The installation's earth electrode, usually an earth loop under the foundations or an earth rod. Note the measured earth resistance.

### [earthing_separator]
The earthing separator disconnects the earthing conductor from the main earthing terminal so you can measure the earth electrode's resistance.

### [panel_distribution]
The switchboard and distribution board where circuit breakers and RCDs feed the circuits. On the situation plan it shows where the board is located.

### [junction_box]
A junction box or branch box where cables are connected or branched.

### [junction_panel]
A junction cabinet: a larger enclosure where several cables are connected or distributed, without protective devices.

### [terminal_strip]
A terminal strip, a row of terminals where conductors are connected through, for example in a distribution board or technical cabinet.

## [protection] Protection devices
Devices that disconnect a circuit on overload, short circuit, earth leakage or overvoltage.

### [mcb]
A circuit breaker protects a circuit against overload and short circuit. State the poles, rated current and curve, for example 2P 20 A curve C.

### [rcd]
An RCD disconnects as soon as current leaks to earth. State the sensitivity, type and rated current, for example 300 mA type A 40 A.

### [rcbo]
An RCBO combines a circuit breaker and an RCD in one device for a single circuit. State the values of both.

### [fuse]
A fuse protects against overcurrent by melting. State the current and type, for example 16 A gG.

### [spd]
A surge protection device diverts short voltage spikes, for example from a nearby lightning strike, to earth.

### [rotating_switch]
A rotary switch with several positions, for example as an isolator next to a heat pump or to choose between operating modes.

### [source_changeover]
A source changeover switch selects between two supplies, for example grid and generator, so they are never connected to the installation at the same time.

## [outlets] Socket outlets
Socket outlets and their variants. The symbol shows earthing and child protection.

### [socket_gnd_child]
The usual socket in a Belgian home: with earth pin and child protection.

### [double_socket_gnd_child]
Two sockets with earth pin and child protection in one flush box.

### [socket_child]
A socket with child protection but without an earth pin, as still found in older installations.

### [double_socket_child]
Two sockets with child protection, without earth pin, in one flush box.

### [modular_socket]
A modular socket on the DIN rail in the distribution board, for example to power a router or home automation module.

### [socket_gnd]
A socket with earth pin, without child protection.

### [socket]
The general symbol for a socket outlet. Add earthing, child protection or a switch with the variants.

## [switches] Switches and controls
Everything that controls a circuit or appliance, from an ordinary switch to a relay.

### [switch]
An ordinary switch turns a light point or appliance on and off from one place. There are variants for 1, 2, 3 or 4 poles and with a pilot lamp.

### [switch_1p_twoway]
A two-way switch controls a light point from two places, for example at the bottom and top of the stairs.

### [switch_cross]
An intermediate switch sits between two two-way switches so you can switch from three or more places, for example in a long hallway.

### [switch_dimmer]
A dimmer adjusts the brightness of a light point.

### [switch_1p_changeover]
A double switch controls two circuits separately from one place, for example the ceiling light and spots in the living room.

### [switch_shutter]
A roller shutter switch controls the upward and downward movement of a shutter or blind. Draw the driven motor as a separate appliance.

### [switch_1p_pull]
A pull switch is operated with a cord, mostly seen in older bathrooms.

### [contact]
A separate contact, for example a door contact or an input of a home automation system.

### [switch_impulse]
A push button sends a short pulse to an impulse relay or home automation input instead of switching the circuit directly.

### [light_sensor]
A twilight switch turns lighting on automatically when ambient light falls below the set threshold. The two arrows towards the contact indicate that it responds to light. This is a light-operated switch, not a motion detector.

### [motion_detector]
A motion detector switches lights automatically when it detects movement. You may state the technology: IR, radar or a combination.

### [smoke_detector]
A mains-powered smoke alarm, possibly interconnected with other alarms.

### [relay]
A relay or impulse relay in the distribution board switches a circuit on a control signal. There are variants for timer, time switch, impulse, thermostat and dimmer.

## [lighting] Lighting
Light points and luminaires, as you draw them per room on the situation plan.

### [light_point]
A light point is the connection point for a luminaire on the ceiling or wall. There are variants for emergency lighting and a built-in switch.

### [light_spot]
A spotlight or projector with a directed beam, with variants for a narrow and a diverging beam.

### [light_led]
An LED luminaire, for example an LED panel or LED strip.

### [light_fluorescent]
A fluorescent luminaire or tube.

## [appliances] Fixed appliances
Household appliances and other fixed loads. The diagram then shows which circuit each appliance is on.

### [stove]
An electric cooker or hob, usually on its own circuit.

### [oven]
An electric oven.

### [washer]
A washing machine.

### [dryer]
A tumble dryer.

### [dishwasher]
A dishwasher.

### [freezer]
A freezer.

### [fridge]
A fridge.

### [microwave]
A microwave oven.

### [door_lock]
An electric door lock or door opener.

### [ev]
A charging point for an electric car, on its own circuit.

### [motor]
An electric motor, for example for a gate, pump or roller shutter.

### [fixed_appliance_generic]
The general symbol for a fixed appliance that is not in this list. Write the appliance name next to it.

## [hvac] Heating, hot water and ventilation
Water heaters, heating, heat pumps and ventilation.

### [boiler]
An electric water heater, with a variant for a storage water heater.

### [heating]
An electric heater, such as a convector. There are variants with storage and with a built-in fan.

### [ventilation]
A fan or ventilation unit, for example a mechanical heat-recovery ventilation system.

### [furnace_heatpump]
A heat pump.

### [furnace_gas]
A gas boiler. Electrically this is the supply of the burner, pump and controls.

### [furnace_oil]
An oil-fired boiler.

### [furnace_pellets]
A pellet stove.

### [furnace]
A general heat source, with variants for the energy source (electricity, gas, liquid or solid fuel) and the type.

## [sound] Signalling
Devices that give an audible signal.

### [buzzer]
A buzzer.

### [bell]
A bell, for example the doorbell.

### [horn]
A horn.

### [siren]
A siren, for example of an alarm system.

## [domotica] Home automation
Smart control of lighting, sockets and other circuits.

### [domotica]
A home automation control is drawn as a rectangle in two parts: the basic symbol, such as a switch or socket, at the bottom and the type of control at the top. There are variants for programmable, wireless, detection and push-button control.

## [metering] Metering
Meters that record consumption or production.

### [energy_meter]
A kWh meter, for the grid operator's meter or a sub-meter, for example for a charging point.

## [energyConversion] Sources and conversion
Solar panels, batteries and devices that convert voltage or current type. State the characteristics of a source on the one-line diagram or in the installation file.

### [transformer]
A transformer, for example a bell transformer or an isolating transformer. There are variants for safety and short-circuit-proof transformers.

### [rectifier]
A rectifier converts alternating current to direct current.

### [inverter]
An inverter converts the direct current from solar panels or a battery to alternating current.

### [dc_dc_converter]
A DC/DC converter, also called a chopper, converts a DC voltage to another level.

### [solar_panel]
A photovoltaic panel or string of panels. State the number of panels and the peak power.

### [battery]
A home battery or other energy storage.

### [dc_bus]
A DC busbar: a shared direct-current connection for panels, battery and inverter.
