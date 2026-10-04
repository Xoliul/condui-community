# Condui portable project file format

This document specifies the portable project archive that Condui reads and writes in both the hosted and community editions. It is the compatibility contract for project backup, transfer, and self-hosted use. Hosted storage and permissions are not part of this format.

The implementation sources of truth are:

- `apps/app/src/types/projectV2.ts` for the current JSON document types;
- `apps/app/src/lib/projectV2/migration.ts` for accepted schema versions and normalization;
- `apps/app/src/lib/export/portableProjectPackage.ts` for the shared archive reader and writer;
- `apps/app/src/lib/export/exportProjectToZip.ts` and `apps/app/src/lib/export/importProjectFromZip.ts` for hosted-only policy and version-history integration.

## Archive

A project file is a DEFLATE-compressed ZIP archive. File names use `/` separators and are relative to the archive root.

| Path            | Required          | Purpose                                                           |
| --------------- | ----------------- | ----------------------------------------------------------------- |
| `project.json`  | Yes               | The persisted project document.                                   |
| `manifest.json` | Written by Condui | Informational archive metadata. The importer does not rely on it. |

Readers must ignore unrecognized archive entries. Binary project-owned payloads may be externalized below `assets/`; readers hydrate those references back into data URLs or SVG text. Optional version-history and cached-PDF entries are informational extensions and must not be required for project loading.

The current manifest has archive format version `1`, the format label `project-with-assets`, and the `project.json` entry name. The archive-format version and the project schema version are independent.

## `project.json`

The current schema version is `2.3.0`.

The project locale supports `nl-BE`, `en`, `fr-BE`, `de`, `pl`, and `ro`.
Electrical JSON imports accept the same locale codes. Dutch remains the default.

The root document contains these portable domains:

| Field                    | Role                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`          | Project JSON schema discriminator.                                                                                                             |
| `project`                | Identity, name, timestamps, locale, optional historical template provenance, customer/installation metadata, and local editor resume settings. |
| `site`                   | Optional installation address and geographic context.                                                                                          |
| `building`               | Floors, shared plan calibration, spaces, and optional georeferencing.                                                                          |
| `systems`                | Stable system records referenced by layers and elements.                                                                                       |
| `layers`                 | Display/export grouping for building, electrical, and annotation content.                                                                      |
| `elements`               | Persisted geometry and element properties.                                                                                                     |
| `relationships`          | Directed links between elements.                                                                                                               |
| `views`                  | Floor-plan, one-wire, panel, and export view definitions.                                                                                      |
| `assets`                 | Metadata and references for floor-plan and other project-owned files.                                                                          |
| `disciplines.electrical` | Installation, panels, devices, plan wiring, one-wire annotations, optional supply assemblies, and optional canonical wire runs.                 |
| `validation`             | Optional quarantined data retained for recovery and diagnostics.                                                                               |

The optional `project.showInspectionAgencyInInfoBlock` boolean controls whether the
portable inspection-agency contact stored in `project.inspectionAgency` is rendered as
a fourth column in drawing info blocks. Missing or `false` leaves the standard
three-column info block unchanged.

`project.origin` is optional historical provenance for a project initially seeded from
a cloud template. When present it has `kind: "template"`, `templateId`,
`templateName`, `templateRevisionId`, and `seededAt`. It is a snapshot: readers must
not treat it as a live reference, and copying or importing the project may preserve it.
It must not cause unrelated project copies to acquire template provenance.

Within `disciplines.electrical`, a protection record with `directPanelFeeder: true` is a
structural one-wire carrier for a secondary panel connected directly to a busbar. It
retains the feeder circuit and `subPanelId`, but readers must not interpret it as a
physical protection device or render a protection symbol.

A secondary panel may persist `hasGround: true` with `groundTrunkDevices` for a local
earth-electrode stem on that board. The shared main-board electrode remains on
`disciplines.electrical.installation.hasGround` and `groundTrunkDevices`. Missing or
`false` panel values mean that board has no local electrode. Older files without these
panel fields remain valid.

An EV endpoint with `symbol: "ev"` may persist
`evChargerProps.integratedDcResidualProtection: true` when the charger includes
coordinated residual-DC protection or detection, such as 6 mA DC detection. Missing
or `false` means the helper validation does not treat the charger as providing that
protection. The field is optional and older projects remain valid without it.

A socket endpoint may persist `socketProps.modular: true` for a panel-mounted DIN
modular socket. It is electrically identical to a wall socket and uses the same
one-wire symbol and rules. Readers must omit it from the situation plan without
treating the missing placement as invalid. It remains visible in the panel view
and is limited to one or two outlets (two or four DIN modules). Missing or `false`
means an ordinary wall socket.

Control addressing records which channel of a building-control device (KNX, DALI,
Loxone, Niko Home Control) feeds a load. It is descriptive only: addresses are labels for
the installer and integrator, never programming data. Every field below is optional;
missing means unspecified, and older files remain valid.

Both kinds of connection share one addressing shape, `{ channel?, groups? }`. `channel`
is a free-text physical channel (`C`, `5`, `Q7`); readers accept a legacy JSON number and
treat it as its decimal string, and compare channels trimmed and case-insensitively.
`groups` is a list of free-text logical addresses (KNX group addresses `1/2/3`, DALI
groups `G1`); readers trim entries, drop blanks and ignore case-insensitive duplicates.

- An endpoint may persist `controlLink: { deviceId, channel?, groups? }` as a virtual
  "operated by" relation. `deviceId` is the id of a domotica module endpoint (an endpoint
  with `symbol: "domotica"` and no `domoticaChildProps`) or of a relay endpoint
  (`symbol: "relay"`, e.g. an impulse relay whose coil sits on a control circuit). The UI offers the link on
  `contact` endpoints. The link carries no topology: it adds no wire and no panel module.
  On the one-wire diagram a valid link replaces the endpoint's own notes (and
  `notesVisible`) with `<device label> · <channel>` (just the device label without a
  channel); a dangling link falls back to the endpoint's own notes.
- An endpoint wired to a module (`domoticaChildProps`) may persist `channel` and `groups`
  with the same meaning.
- Output rows of a module are labelled `{module label}.{n}` by default. The root endpoint of a
  row (the id in the module's `domoticaProps.endpointChildEndpointIds`) may persist
  `domoticaRowLabel` as either `{ kind: "tail", tail }` (row label is the module-derived
  label followed by `tail`, so it follows module renames) or `{ kind: "literal", text }`
  (row label is exactly `text`). Every endpoint on that row shows the resulting label.
  Absent means the automatic label. Showing the row label on the diagram can be turned off
  with `symbolLabelDisplay.visibility.domoticaRowLabel = false` on the same root endpoint.
  Readers ignore an invalid override.
- A domotica module (`domoticaProps`) may persist device fields: `system` and, for a
  gateway, `outputSystem` (each one of `knx`, `niko_hc`, `dali`, `loxone`, `other`),
  `deviceAddress` (free text, e.g. the KNX physical address `1.1.12`), `line` (free text,
  e.g. a DALI line) and `channelCount` (positive integer physical output capacity,
  independent of the drawn `endpointCount`). Wired switches, pushbuttons and detectors
  are the module's inputs and linked endpoints and other wired children its outputs;
  inputs and outputs are numbered independently and inputs never count against
  `channelCount`.

The systems only select syntax warnings (KNX physical address, channel letter or number
and group addresses; DALI short addresses and groups; Loxone I/O names; nothing for Niko
Home Control or `other`). Readers must store any string and never reject invalid values,
a `deviceId` that no longer resolves, channels claimed by several endpoints, or more
connections than `channelCount`; these are validation findings. A module's connected list
and its derived capacity are computed from wired children and linked endpoints and never
stored.

`disciplines.electrical.supplyAssemblies` optionally stores source-side electrical
topology before a root feed or panel input. Each assembly owns a versioned port graph,
its incoming attachment, load handoffs, inverter grouping, and connection properties.
`auxiliaryEnclosures` optionally stores referenced non-panel electrical enclosures.
An auxiliary enclosure may persist `ownerPanelId`, `panelViewPosition`, and a
`gridView` whose slots arrange supply devices in a virtual frame on the panel canvas.
The hierarchy derives the frame's vertical transition band between the shared supply
and its owning main panel; the persisted position remains a horizontal placement hint
and a compatibility value for older editors.
An auxiliary enclosure may also persist `placements`: situation-plan placements with the
same shape as other symbol placements, so supply cables can be routed through it. Hiding
such a placement on its floor (`hiddenSitplanElementIds`) also hides the cables that end at
it. Readers that do not draw enclosures on the plan preserve the list.
It is a visual mounting boundary rather than another distribution panel. A supply
trunk device may persist `panelMounting` with `kind: "grid"`, `kind: "panel"`, or
`kind: "auxiliary"`; this device-owned value is authoritative for which panel-canvas
frame contains it and does not change its electrical feed order or ownership. Grid
slots remain layout data only. Older files that stored the same mounting on a mirrored
supply-node `mounting.enclosure` remain accepted and are promoted to device-owned
mounting when edited. Deleting the
virtual frame returns its mounted devices to the owning panel's first available grid
positions, using the panel overflow band when necessary, without deleting or rewiring
them. Missing arrays mean that the project has no supply-assembly data. The
existing one-wire, panel, and situation-plan canvases derive the representations they
need from the same topology.

The experimental [semantic electrical import](electrical-import/README.md) can create
these existing native supply records from an optional `installation.supply.system`.
That input is a separate creation contract, not a portable project field or a way to
round-trip existing supplies. It introduces no project schema version or ZIP-layout
change: generated devices, supply assemblies, handoffs and pending placements use
the native fields documented here.

A supply inverter trunk device may persist `converterAcConnection: "shared"` or
`"separate"`. Missing values retain the shared grid-connection arrangement.
`"separate"` represents distinct grid and backup AC ports with internal transfer;
without an external changeover, the common downstream load is supplied from the
backup port in both operating modes. The supply graph mirrors this setting in the
inverter node's optional `properties.acConnection`. Existing external-changeover
graphs and independently connected backup circuit handoffs retain their routing.
Older direct assemblies may contain only root-feed devices marked
`supplyPath: "converter-branch"`, without a saved supply graph. They remain editable;
changing their AC connection setting materializes the graph and preserves their DC devices.

A root-feed trunk device may persist `supplyPanelInput: true`. It belongs electrically
after the supply assembly's handoff and before that root panel's bus, independently
of physical `panelMounting`. Assembly reconciliation must not absorb it into the
upstream supply graph. Missing or false retains legacy ownership inference. These
devices remain in the root feed's ordered `trunkDevices` array and render on the
receiving panel, including installations with only one main panel. This marker applies
only to the serial receiving chain. A source changeover or a device with an explicit
non-serial `supplyPath` remains part of the supply branch; readers ignore and the
editor clears contradictory input markers written by older inline-diagram drops.
If explicit supply branches appear after a receiving-chain device in the saved
root-feed list, the editor moves those branches before the receiving chain and
renumbers trunk positions. Relative order within each chain and device references
are preserved; serial panel-input devices retain their ownership.
When an older changeover graph has no inverter node but its root feed contains
exactly one changeover and one backup converter, the editor reconstructs the missing
backup AC and DC branches from those devices. Existing inverter graphs and their
custom wiring are preserved; ambiguous device lists are not inferred.

The first main panel's `gridView.supplyPanelVisible: false` also dismisses the
shared grid frame when it has no visible modules. This removes only the empty
physical frame: hidden devices, mounting, supply connections, and handoffs remain
intact. Any visible device mounted on the grid makes that frame appear again.

Panel `gridView.columns` and slot `col`/`moduleWidth` values are expressed in physical
DIN modules. Panel layout resolves these measurements through an integer
1/12-module grid. Whole-number values retain their historical meaning; fractional
values are normalized to the nearest twelfth, which exactly represents halves,
thirds, and quarters without floating-point occupancy drift. A missing
`moduleWidth` continues to derive the device width from its normal pole/module rules.
Terminal strips default to one third of a DIN module and may use manually persisted
fractional widths on this grid. Panel `gridView` may enable compact terminal-only rows
with `terminalStripTopRail` and `terminalStripBottomRail`. A terminal-strip slot assigned
to one of those rows persists `terminalStripRail: "top"` or `"bottom"`; other device
types ignore that marker and remain in the regular grid.

A circuit terminal-strip occurrence may persist `terminalStripPanelId`, identifying the
physical panel-canvas frame that contains the strip. This value is independent from the
occurrence's circuit and one-wire ownership. Occurrences with the same `junctionIdentity`
represent one physical strip and move together; missing values retain the historical
behavior of showing the strip on its circuit-owning panel.

Panel label editing is module-owned rather than slot-owned. Protection devices, endpoints,
and trunk devices may contain an optional `labelNotes` string and optional `panelLabel`
configuration with `top` and `bottom` cell sources and optional `left`, `center`, `right`, or
`justify` alignment. Each cell retains a singular `source` for compatibility and may contain
an ordered `sources` array; multiple sources render on separate lines. Each source is one of
`label`, `notes`, `labelNotes`, or `technical`. Missing configuration defaults to Extra (`labelNotes`) in
the top cell and combined `label` plus `notes` in the bottom cell; `labelNotes` is not inferred from other
values. Editing a linked cell stores the edited text in `labelNotes` and changes that cell's
source to `labelNotes`. The label export uses the bottom cell for single/on-row strips and
exports the top and bottom cells separately for double-strip output.

Junction-panel trunk devices may persist `junctionPanelGridView`. It stores the shared
panel-canvas rows, columns, feed direction, and optional top or bottom terminal rails
for the physical junction panel identified by `junctionIdentity`. Occurrences with the
same identity represent one enclosure and receive the same grid configuration. Missing
configuration defaults to one row and 18 columns.

Each junction-panel occurrence may also persist `junctionPanelTerminal`, containing the
stable `id`, editable `label`, and `pinCount` of its terminal component. These terminals
are separate selectable components inside the shared junction-panel enclosure. Older
projects without this record derive a stable terminal id, a numbered `X` label, and two pins
until the component is first edited.

A physical supply-assembly node may contain `deviceId`, referencing its canonical
supply-trunk device record. The device record owns editable physical presentation and
equipment data such as symbol, label, rating, manufacturer, model, serial information,
and situation-plan placements. The graph node owns electrical ports, conductors,
connections, and topology-specific behavior. The referenced device owns physical
panel-canvas mounting. Node-level `label`,
`symbol`, and equipment-property values remain readable as legacy fallback snapshots,
but readers must prefer the referenced device and must not require those snapshots to
be synchronized after edits. Virtual utility, handoff, and distribution nodes may omit
`deviceId`.

An assembly may contain `oneWireGeometry`. Its node positions and optional connection
waypoints are independent geometry on the existing one-wire canvas; they are not
properties of the utility source or main panel.

A supply-trunk device may use `type: "changeover"` with
`symbol: "source_changeover"`. It occupies the same ordered one-wire supply slots as
other trunk devices; it is not free-positioned canvas geometry. A changeover and its
branch devices belong to a root-panel feed and must not be stored on the shared feed
before the root-panel boundary.
This is electrical ownership only: their `panelMounting` may target the grid,
any existing main or secondary panel, or an auxiliary enclosure. The electrical
path may leave an enclosure and return to it; moving or reopening mounted devices
must preserve their connections and chosen panel-grid slots.
Supply-trunk relays use `type: "relay"` and `symbol: "relay"`. Their optional
`relayProps` stores the control mode, pole count, and maximum current rating, using
the same fields as ordinary relay devices. Labels, notes, and label display settings
remain on the trunk record. Relays are passive serial devices in AC and DC assembly
paths, not overcurrent protections. Older relay-symbol trunk records with a fallback
type remain readable; reconciliation normalizes their type while preserving their
stored properties and connections.
An ordinary circuit's `trunkDevices` may also contain series switching devices that
switch every branch downstream of their `trunkPosition`: relays use `type: "relay"`
and `symbol: "relay"` as above, and plain switches use `type: "switch"` and
`symbol: "switch"` with the pole count in `poles` (1–4) and `polesConfig`. Other
switch symbols (two-way, cross, dimmer, changeover, pull, impulse) are branch
endpoints only and are not valid circuit-trunk devices.
Supply-trunk devices may contain `supplyPath: "backup"` for the converter,
`"backup-output"` for serial protection between the converter backup output and the
changeover, `"changeover-grid"` for serial devices on the grid-only lower lane before
the changeover grid tap, or `"converter-grid"` for serial protection between that tap
and the converter grid input. A `"converter-grid"` device is inline on the horizontal
run by default; `converterGridPlacement: "input-leg"` places it on the converter's
vertical input leg. A `"changeover-grid"` device is inline on the lower horizontal
rail by default; `changeoverGridPlacement: "input-leg"` places it on the modular
changeover's vertical grid-input leg after the grid branch. With a separate normal bus,
inline lower-lane devices feed that bus; otherwise they continue in series to the
changeover grid input before its input-leg devices. An inverter trunk device may persist
`converterGridInputConnected: false` to represent an intentionally isolated grid AC
input; missing means connected for backward compatibility. A disconnected grid input
has no `inverter-grid-ac` assembly connection and cannot own `converter-grid`
protection devices. Without a changeover it requires separate grid and backup panel
bus sections; an external changeover may instead feed one shared switchable bus. A
changeover-less grid-connected storage branch uses
`"converter-branch"` for its inverter or rectifier and `"converter-dc"` for a battery
or solar source connected to its DC port. Missing `supplyPath` (or `"serial"`) means
the ordinary grid-to-panel path. A converter and its branch devices are mirrored by
nodes in the corresponding supply assembly; the graph connections remain the
electrical source of truth for protected AC and DC paths. Direct storage branches use
the explicit `grid_connected_storage_branch` preset intent and do not require a
changeover. They may optionally feed one protected load circuit from the converter's
backup AC port. That circuit persists `supplySource: { kind: "converter-backup",
converterId }`; the matching assembly handoff initially targets `circuit-input` and may
be retargeted to `panel-input` when the circuit feeds a neighboring secondary panel.
Missing `supplySource` retains the ordinary bus-fed circuit behavior.

For a grid-connected direct converter, the common AC path continues past the
converter branch through every following serial supply device. The assembly graph
owns this continuation and its panel handoffs, including the original main panel.
Additional main-panel inputs depart from the completed common load output; they
must not bypass downstream supply devices by departing at the converter's grid tap.
Physical enclosure assignments do not change this output or its connections.
Recognizable generated legacy handoffs from the utility tap are repaired to that
common output on opening, with their identities and wire properties preserved.
Ambiguous or custom connections are retained for validation instead of being guessed.
Changing a main panel into a secondary panel removes its obsolete root-input
handoff so the selected circuit becomes its electrical feed.

Load-time compatibility repair must preserve supply devices and assembly graphs it
cannot assign unambiguously. Inconsistent ownership, a missing converter counterpart,
or an unsupported graph must be reported for validation or manual repair; readers must
not silently delete or flatten those records while opening the project. One explicit
exception is a legacy ZIP whose `loadHandoffs` target a panel that is absent from the
same archive: the ZIP importer removes only those dangling handoff records and their
graph-only handoff nodes/connections, then reports the repaired handoff count to the
user. The original archive is not modified, and all surviving project data remains
available for import.

Supply changeovers may persist independent `changeoverProps.port1Label` and
`changeoverProps.port2Label` display text. Their visibility uses the device's generic
`symbolLabelDisplay.visibility` map. The installation may persist
`supplyTrunkNotesOrientation` as `"horizontal"` or `"vertical"`. This preference is
shared by all visible device notes on attached supply wires and is independent of
`circuitNotesOrientation`. Detached supply assemblies render device notes horizontally
to keep their frame footprint bounded. Missing values remain horizontal. Supply-assembly connections may carry independent
`wireProperties`; one-wire segments derived from those connections retain the assembly
and connection identity so edits to inverter inputs, backup outputs, changeover inputs,
and separate DC branches do not mutate the ordinary main-supply wire settings.
Supply-wire conversion devices may persist one shared
`conversionProps.acPhaseAssignment`. It applies to every AC port of that converter and
to the corresponding assembly connections, independently of the selected cable's core
count. A multiplied inverter may instead persist ordered
`conversionProps.acPhaseAssignments`, mapped one-to-one to its ordered physical units.
Two-unit inverter groups use those independent assignments; three-unit groups derive a
locked full three-phase set and distribute one line phase per unit. A missing value
inherits the installation voltage system.

SPD protection records and SPD trunk devices may optionally contain
`surgeProtectionKind`. The accepted values are `standard` for one-arrow lightning
protection and `sparkGap` for the two-arrow spark gap. A missing value is
backward-compatible and renders as `standard`.

Electrical circuits may optionally contain `phaseAssignment`. The value identifies the
active AC phases carried by that circuit (`L1`, `L2`, `L3`, and optionally `N`) and its
shape (`single_phase`, `phase_to_phase`, or `three_phase`). The same optional field may
appear on a domain wire override or section wire override when that wire has a more
specific assignment. Missing assignments are backward-compatible. On three-phase
installations, readers may derive the assignment from the circuit's busbar slot;
otherwise the wire inherits the active phases from its upstream source. A concrete
reduced assignment inherited from an upstream circuit locks the downstream phase set.
`showPhaseLabel` is an optional boolean on circuits and wire
overrides; it defaults to false and controls the optional one-wire phase annotation.
`PE` is not part of the assignment because it remains a continuity conductor. The
wire editor narrows available conductor counts from the upstream protection's pole
configuration (for example, a 3-phase feed entering a 2-pole protection becomes a
single-phase L+N wire in a `3N~` installation).

Circuit trunk devices may optionally contain a `placements` array using the same
situation-plan placement shape as endpoint placements. This supports physical
trunk-mounted devices such as transformers, rectifiers, inverters, and DC-DC
converters. A missing array remains valid and means that the device has no
situation-plan instance.

A passive terminal strip uses `type: "terminal_strip"` and
`symbol: "terminal_strip"`. Its `junctionIdentity` stores the shared physical strip ID
without the fixed display prefix (for example `1` displays as `X1`), while
`terminalStripPin` stores the positive pin number. The combined display is therefore
`X1-3`. An in-line trunk occurrence additionally stores `terminalStripOutgoingPin`,
so its two wire connections can address distinct terminals and display as `X1-3/4`.
`terminalStripPin` is the incoming connection and remains the sole pin for an endpoint
occurrence. These fields are connection-endpoint data owned by the canonical V2
electrical device occurrence; they do not create duplicate physical strip identities.
Pins are unique within one strip identity. Assigning an occupied pin moves only
the conflicting occurrence to the vacated pin when possible, otherwise to the nearest
free positive pin. Gaps are valid and stored identities are never renumbered on load.
Legacy combined identities such as `1-3` remain accepted and are split when edited.

Junction boxes, junction panels, and terminal strips may persist `junctionIdentity`.
Equal identities on occurrences of the same symbol identify one shared physical
junction while each occurrence retains its own electrical circuit position. Endpoint
`label` remains branch-owned automatic naming and does not replace this identity.

An ordinary circuit-trunk inverter, rectifier, or DC-DC converter may persist
`conversionProps.dcConnectionCount` from 1 through 4. Missing and invalid values are
read as one. The one-wire converter remains anchored on its first block and grows to
the right; panel-grid and situation-plan symbols keep their normal size. A one-port
converter retains the ordinary circuit trunk: its panel-side segment uses the incoming
domain and the segment above the converter uses the outgoing domain, where endpoints
remain ordinary branches. Widened converters use separate terminal lanes and persist
`converterDcConnection.converterId` with a zero-based `connectionIndex` for their
output endpoints. These references identify the same output paths in the one-wire
and derived electrical structure, and do not replace the endpoint's ordinary
branch membership.

A circuit trunk device with `type: "dc_bus"` and `symbol: "dc_bus"` represents a
selectable DC distribution busbar. Optional `ratedCurrentA` and `ratedVoltageV` are
descriptive ratings. A bus placed on an ordinary converter output uses the same
`converterDcConnection` reference as other serial DC devices. Its outgoing taps are
ordinary branches in the converter's existing circuit: each owning `Branch` persists
`dcBusId` and keeps its serial endpoint/device chain in `endpointIds`. The one-wire
view also accepts an unlinked rail on an ordinary one-port converter trunk. The
derived structure infers its output-zero relationship only when the circuit has
exactly one converter, one rail referenced by a branch `dcBusId`, and no other
owner of output zero. That inferred relationship may be absent from older stored
projects; editor hydration and save write the unambiguous
`converterDcConnection` onto the rail. The one-wire
view renders the branches as vertical DC taps, but they do not create child circuits
or protection records. Deleting the final endpoint removes the empty branch; deleting
the bus removes all branches and endpoints that carry its id. An empty ordinary-panel
bus is terminal at the normal first endpoint branch row and has no continuation above
the rail. The rail is exclusive per inverter output: inserting one promotes that
output's existing endpoint branches by assigning its bus id, and later endpoint drops
on that output are stored as rail branches. Multi-port promotion affects only the
selected converter connection. This ordinary-panel rule does not modify supply-assembly
DC-bus branches. The unreleased legacy `dcBusProps.branchCircuitIds`, `dcBusSource`, and
`directDcBusFeeder` fields remain accepted for existing development files but are not
written by ordinary-panel DC-bus interactions. A DC-rail `Branch` may additionally persist
an optional `branchDevices` array for serial branch-local devices such as protections. The
array is ordered from the bus toward the endpoint chain. These devices remain owned by the
parent circuit in the electrical structure; `dcBusId` identifies their one-wire fan-out
rail, but the bus is not their serial parent and they do not create child circuits.
An inverter or DC-DC converter within `branchDevices` may use
`conversionProps.dcConnectionCount` with the same one-through-four range. When widened, it
grows to the right and downstream branch devices and endpoints persist a
`converterDcConnection` reference to one of its zero-based output lanes. Existing serial
content becomes output zero when the converter is first widened. Returning to one output
removes that explicit output-zero ownership and restores the ordinary serial branch.
For compatibility, a one-port inverter or DC-DC converter already stored in a DC-rail
`endpointIds` chain remains accepted. Widening it, or adding the first device to its DC output,
promotes the same stable id and portable
device metadata into the owning branch's `branchDevices` array before assigning its
downstream endpoints to output zero.

Ground-trunk earthing separators are physical pairs. Each paired separator record may
carry the same optional `earthingSeparatorPairId`; editors select and delete the pair
as one item. Older files without this field remain valid: consecutive unpaired
earthing separators are interpreted as legacy pairs.

When an older project contains a circuit endpoint or circuit trunk device with
symbol `junction_box` and no placement, the editor creates a visible placement
while loading. This compatibility repair uses the circuit's known floor when
possible and otherwise falls back to the project's first floor.

Situation-plan placement is optional for transformers, rectifiers, inverters,
DC-DC converters, solar panels, and batteries. Their absence is not a project
integrity error. When loading older conversion devices without placements, the
editor creates visible placements. Inverter panel visibility and situation-plan
visibility are independent; loading preserves explicit hide choices in either view.
Other conversion placements stored as hidden by an older editor version are
automatically made visible while loading.

Supply-trunk inverters, including supply-assembly inverters, are hidden in the panel
view by default. The physical enclosure's `gridView.hiddenModuleKeys` and
`gridView.shownModuleKeys` store explicit hide/show choices. An existing grid slot
only stores a position and does not make an inverter visible. Hiding an inverter
does not remove its mounting or electrical connections.

A supply-trunk inverter, battery, or solar-panel device may contain an ordered
`serialNumbers` array in its device-specific properties. The array maps one-to-one to
the device's ordered situation-plan placements and represents multiple physical units
rendered as one multiplied symbol in the one-wire view. A missing array keeps the
legacy single-unit `serialNumber` behavior. Readers must preserve placement and serial
ordering together when adding or removing units. Inverter unit arrays live in
`conversionProps`; battery and solar arrays live in `batteryProps` and
`solarPanelProps`. Per-unit inverter AC phase ordering must remain aligned as well.
Supported supply-inverter unit counts are one, two, and three; battery and solar groups
may contain up to 99 units.

Supply-trunk devices on a hybrid inverter's secondary DC branch use
`supplyPath: "converter-dc-top"`; the original right-hand DC chain continues to use
`"converter-dc"`. Devices within either branch remain ordered by their position in the
owning supply trunk array. Supply converters may use
`conversionProps.dcConnectionCount` from 1 through 4 and grow left in the one-wire
supply assembly. That value counts upper DC exits; the established side DC exit remains
available in addition. A device on one of those independent DC lanes may persist a zero-based
`supplyConverterDcConnectionIndex`. Missing values remain backward-compatible:
`"converter-dc"` implies index 0 and `"converter-dc-top"` implies index 1.
Devices with different `supplyConverterDcConnectionIndex` values occupy separate
converter exits in the supply assembly graph. Older files that chained devices
across those exits are repaired on opening; existing connection IDs and wire
properties are retained while the upstream endpoint is corrected.

A supply-side DC busbar uses the same `type` and `symbol` values. Domotica devices
dropped on that bus persist `type: "domotica"` and `symbol: "domotica"`; their
`domoticaProps` may preserve the displayed control capabilities and inner device
configuration, but endpoint-output count is not used on this DC-only placement.
Other devices dropped on the bus retain their own trunk-device type. All bus devices
persist `supplyDcBusId` pointing to the bus device and a stable
`supplyDcBusBranchId` identifying their fan-out branch. Devices before the bus omit
these fields and remain in serial lane order, so a protection or junction box can
precede the bus on either the side lane or any upper converter lane. The derived
supply-assembly graph represents the bus as a `dc-bus` node with a multi-connection DC
port. A supply-bus domotica node keeps only its serial DC port; the trunk-device
records remain the portable source of truth.
A DC-DC converter or inverter on one of those fan-out branches may also persist
`conversionProps.dcConnectionCount`. Devices after a widened branch converter retain the
outer `supplyDcBusId` and `supplyDcBusBranchId`, and additionally use
`converterDcConnection` to identify their local zero-based string lane. The outer
`supplyConverterDcConnectionIndex` continues to identify the root supply converter lane;
the two references describe distinct nesting levels.

Situation-plan placements store their orientation in `rotationDeg` as clockwise degrees.
User rotation commands use quarter-turns (`0`, `90`, `180`, or `270`); automatic
orientation beside a drawn curved wall may store an intermediate angle matching the
wall normal at that point. A placement with `rotationMode: "explicit"` was rotated by
the user and must not be auto-oriented to nearby walls. Missing `rotationMode` is
backward-compatible and leaves auto-orientation available for symbol kinds that support
it; a missing or invalid legacy angle is read as zero.

A situation-plan placement `style` object may carry two optional boolean hints.
`customPosition: true` records that the user positioned the symbol; tools that re-lay-out
automatic placements should leave such placements where they are.
`awaitingPlacement: true` marks an automatically created placement that the user has not
put on the plan yet: editors keep it off the drawn and exported plan, still list it for
placement, and clear the flag once the placement receives an explicit position. Both
hints are absent on older files, which keeps every placement drawn as before. Loaders
keep the `style` object as-is.

Situation-plan wall elements may optionally contain a `curve` property with
`kind: "rationalQuadratic"` and a positive numeric `weight`. A curved wall stores
exactly three geometry points in start, control, end order. The weight
`0.7071067811865476` produces an exact quarter circle when the two control legs are
equal and perpendicular. Missing curve metadata means the wall points form an ordinary
polyline. Doors, windows, and bare openings must not reference a curved wall.

Panels may optionally contain `busbarPhases`. Its `main` array stores the repeating
`L1`/`L2`/`L3` order for the panel's main busbar. Its `secondary` object stores an
independent repeating order keyed by the stable id of the grouping protection or parent
circuit that owns that secondary busbar. Missing or invalid orders use `L1`, `L2`, `L3`.
Each busbar restarts its own sequence. In `3N~`, two-pole slots derive `L1+N`, `L2+N`,
and `L3+N`. In `3~`, the order applies per physical pole: each two-pole device consumes
two consecutive positions, producing `L1-L2`, `L3-L1`, `L2-L3`, then repeating for the
default order. Devices with more poles follow the same rule: they start at the current
pole offset, list consecutive phases in that order, and advance the offset by their pole
count (for example `2P, 3P, 2P` produces `L1-L2`, `L3-L1-L2`, `L3-L1`).

Panels may optionally contain `earthingSystem` for the earthing arrangement on their
normal/grid feed and `backupEarthingSystem` for the arrangement on a connected backup
feed. Missing values mean that the corresponding arrangement is not selected. The
backup value is only rendered when the panel has an active backup supply path; older
files without it remain valid.

Panels may optionally contain `busSections`, representing independently supplied
top-level busbar sections inside one physical panel. `primaryBusSectionId` identifies
the default section for legacy or unassigned top-level devices. Top-level protections
and unprotected circuits may reference a section through `busSectionId`; circuits
below a protection inherit the protection's section. A section's optional `role`
(`normal`, `backup`, or `custom`) is a presentation hint only. Its optional
`phaseOrder` controls independent automatic phase sequencing and may contain a single
line phase for a single-phase bus in a multi-phase installation. Missing
`busSections` retains the historical single main bus and does not add persisted
placeholder data.

A root feed may optionally target one explicit bus section through `busSectionId`.
A supply-assembly attachment or load handoff may use `panel-bus-input` with `panelId`
and `busSectionId`. The existing `panel-input` attachment remains accepted and means
the panel's primary or implicit legacy bus. Incoming source capability and conductor
availability are derived from the targeted feed or handoff; the bus section's display
role must not be interpreted as electrical source truth. Multiple uncoordinated
incoming supplies to the same explicit section are invalid.
For the generated normal-bus handoff of a switched root-feed assembly, the
handoff and the root-feed record are two persisted projections of the same
physical input and must not be counted as independent supplies.
Likewise, a root-feed record whose devices are all marked `supplyPanelInput: true`
can carry the panel-side device chain after an assembly handoff to that bus
section. It does not create a second incoming source. Repeated busbar runs of
that section display the same device chain without duplicating its devices.

For a root feed with a modular changeover and inverter, the ordered trunk-device
roles describe distinct physical branches rather than one flattened serial list.
`converter-grid` with `converterGridPlacement: "input-leg"` is serial on the
inverter's grid input; the default `"inline"` placement is serial on the continuing
grid run before its split. `backup-output` is serial between the inverter backup
output and the changeover backup input. `changeover-grid` is serial between the grid
split and the normal-bus handoff; `changeoverGridPlacement: "input-leg"` places that
serial protection on the vertical leg between the split and the changeover's grid port.
Ordinary serial devices after the changeover record
are on its load path before the backup-bus handoff. The supply-assembly graph persists
the corresponding split node, both panel-bus handoffs, and these separate paths; a
reader must not infer one electrical chain merely from trunk array order.

DC supply-assembly connections are stored in energy-flow order. Solar and battery
branches point through any intervening DC protection or distribution nodes toward the
converter DC port. Storage ports may remain electrically bidirectional, but this does
not reverse the branch's source-to-converter structural direction.

When a direct inverter upgrades a simple root feed, the assembly records a separate
root-feed handoff for that panel and shared-output handoffs for the other main panels.
Root-feed protections retain their local branch ownership; they do not become shared
because another panel references the same assembly diagram. Bare historical direct
graphs without handoffs receive these connections on load; existing explicit common
output and custom handoffs retain their original meaning.

Supply-assembly connections and load handoffs are authoritative for the panel input
or bus section they target, including historical `root-feed` targets. A matching
`feedTopology` record is a projection, not an additional incoming connection.
Readers must not replace a disconnected assembly handoff with a direct shared-feed
or meter connection. Such a handoff is an explicit connectivity error, even when its
node identity and conductor set are otherwise valid.

Reconciliation preserves other panel handoffs and private branch connections when
rebuilding an editor-managed supply path. Generated root-panel fan-outs follow the
common load-path tail, including serial devices after the changeover. Older files
with a recognizable generated root-panel handoff stranded by the historical writer
are repaired on load; unknown disconnected handoffs are preserved for diagnosis.
Physical `panelMounting` changes do not change electrical adjacency, connection
order, or handoff ownership. No schema-version change is required for this repair.

Phase choices are filtered by the installation's nominal voltage system: `3~` exposes
only `L1`, `L2`, and `L3` combinations and never `N`. The phase assignment controls are
hidden for `2~` (2×230 V), where there is no user-facing phase identity.

Each `feedTopology.rootFeeds[]` record may optionally contain `phaseAssignment` and
`showPhaseLabel` for the private, panel-side supply section. These fields are scoped by
`panelId`; they never narrow the shared utility-side feed or another main panel. A
reduced-pole protection on that root feed determines and locks the effective incoming
phase set after the protection. That lock overrides incompatible stored choices and is
inherited by the panel busbar, all circuits in the panel, and their downstream panel
chains. Missing fields remain a full-phase incoming supply for backward compatibility.
The same root-feed record may contain a `wireSections` map keyed by a stable physical
run identifier. Each value stores the cable, installation method, route, label
visibility, fire-class visibility, and optional length for one uninterrupted run
between supply devices or terminals. Orthogonal drawing pieces around a corner share
one key; a protection or other inline device starts a new run. Missing `wireSections`
keeps the role-level main-supply defaults used by older projects.
Cable specifications may use the stable `kind` values `battery-cable` and `twinflex`
for DC battery wiring; these are portable data values and are localized only when
displayed in the editor or drawing labels.

`disciplines.electrical.wireRuns` (schema `2.2.0` and later) is the canonical per-edge wire model
(Goal 19 / ADR-0002). Each run holds a shared `cable`, a `conductors` list (per-phase
function, optional per-core section), an optional `medium` (`cable` or `busbar`) with
`material` and `busTapLengthMode` for busbars, route/tube flags, per-member `segmentLengths`
in metres, and `members`: stable anchor keys (not relationship ids) of the edges sharing the
run. The optional `segmentLengthSources`, keyed like `segmentLengths`, marks a length with
`'estimated'` when it was accepted from a plan-based route estimate rather than entered; a
missing entry means an entered length. Recalibration invalidates accepted estimates with
`'estimated-stale'` and removes their numeric `segmentLengths` entry. This marker may therefore
remain without a length until the estimate is reviewed. Readers must not use a stored length
marked stale for electrical checks. Older readers see a missing length. An explicit length edit
or renewed acceptance replaces the stale marker; manually entered lengths are preserved.

The circuit-section connection into `bus-section:secondary-bus:<circuitId>` is a
secondary-bus feeder and supports both `medium: "busbar"` and `medium: "cable"`.
An unauthored feeder defaults to a busbar; an authored cable run remains a cable.
In busbar mode, the feeder and outgoing rail taps share the rail's cable and conductor
properties. Switching a connection to busbar joins this shared run and inherits its
current specification, discarding that connection's former cable dimensions. Busbar mode hides
wire labels and routing decorations; selecting cable mode restores the wire label.
Outgoing bus taps also support either medium. Selecting a cable type separates that
connection into its own run, leaving the horizontal rail and neighbouring taps unchanged.

Situation-plan wire traces are stored as `electrical.plan-wire.<kind>` elements whose
`properties.route` holds the whole trace: `from`/`to` symbol placements, a `source` of `auto`
or `manual`, and manual `waypoints`. Two optional fields describe cable routing:
- `wireAnchor` names the one-wire wire whose cable the trace draws.
- `riser` marks a trace whose cable arrives from another floor: `fromFloorId` names that floor,
  and an optional `pos` moves the vertical passage away from the source symbol's plan position.
  A passage is shared: every manual trace leaving the same source placement for the same floor
  stores the same `pos`, and loaders apply it to that source's other cables to that floor.

Both are optional, and readers that ignore them still draw the trace between its placements.
`disciplines.electrical.planWiring.visibility` may also carry optional cable-routing settings:
- `homeRunsVisible`: wires from the board to the first point of a circuit (absent means off).
- `branchFeedsVisible`: wires linking lighting branches (absent means off).
- `supplyVisible`: supply cables (inverter, solar panels, batteries) and earthing conductors
  (absent means on).
- `colorCoded`: colour plan wires by group outside wire mode too (absent means off).
- `cableRouteSettings`: mounting heights in metres the length estimate assumes, each optional:
  `floorHeightM`, `socketHeightM`, `switchHeightM`, `panelHeightM`.

Its `defaultStyle` is `spline`, `orthogonal`, or `straight`; readers that do not know `straight`
fall back to their default style. The `2.2.0` migration seeds this collection best-effort from the legacy owners
(`sectionWireOverrides`, feed `wireSections`, supply-connection `wireProperties`); unmapped
legacy wire data falls back to defaults rather than blocking the migration, and the seed runs
only when the collection is absent so edited runs are preserved on re-save. The legacy owners
remain readable during the transition.

A run's `route` is `wall` (in the wall), `on-wall` (surface-mounted on the wall), `ground`, or
`air`; absent means no route. Legacy owners express the same choice as `wireRoute` plus an
`inWall` flag, where `wireRoute: 'wall'` without `inWall` means on the wall, and `inWall` alone
means in the wall. The `2.2.0` seed stored every wall route as `wall` and dropped routes implied
only by `inWall` or a domain override; the `2.3.0` upgrade re-derives the route of each run whose
members all come from legacy owners and whose route still equals what that seed wrote. Runs whose
route or membership changed since are kept as they are.

New wire edits write only to `wireRuns`. Circuit anchors identify the downstream device
or derived secondary rail and electrical domain. A secondary rail is derived from a
circuit’s `subCircuitIds`; its feeder has its own circuit anchor, separate from the
rail’s protection-input tap anchors. No additional persisted rail record is required.
Protection inputs use a panel/protection anchor, earthing inputs a
downstream device or panel anchor, and subpanel feeds a receiving device or bus anchor.
Supply paths retain their stable feed-section or assembly-connection anchors. Anchor keys
are opaque to external readers. Older node-pair anchors for shared supply-feed edges
are rewritten to their canonical feed anchors on opening or saving, retaining run
membership and per-segment lengths. Repeated drawing pieces share an anchor, and a busbar run
may contain several tap anchors. Editing its specification changes all members; editing
`segmentLengths[anchor]` changes only that connection. Empty or unknown legacy wire owners
remain default inputs until a run is authored. Drawing-only `wireAnchor`, `wireAnchors`, and
`wireBusGroup` metadata are recomputed and are not required portable project data.

`disciplines.electrical.installation.defaultCableKind` is an optional cable `kind` that AC
circuit wires follow while nobody has chosen their type. New circuits are still written with
a concrete `cable` of kind `XVB`; readers treat an AC circuit wire without an owning run whose
circuit cable has kind `XVB` (and no `customKind`) as following the default, and render it
with `defaultCableKind` while keeping its section, cores, and fire class. A circuit cable of
any other kind is authored and kept. A run may set `followsDefaultCable: true` to mark that
its `cable.kind` is inherited rather than chosen; its other cable fields stay authored. Both
fields are ignored for DC, supply, earthing, and busbar runs. A missing `defaultCableKind` is
`XVB`, so older projects render unchanged; no schema version change is required.

Some current documents also require the reserved compatibility containers `collaboration`, `comments`, and `chronology`. Local implementations must preserve unknown members in these containers and use the neutral values produced by `createEmptyProjectV2` or the official migration code rather than constructing them by hand. They must not infer local permissions or enable features from their contents.

These containers are named only because removing or rewriting them can make loading or round trips lossy. Their internal service-side interpretation is outside the portable format.

IDs are opaque strings. References such as `floorId`, `panelId`, `systemId`, `layerId`, `assetId`, `fromElementId`, and `toElementId` must resolve within the same document unless the field is explicitly optional. Timestamps are ISO 8601 strings.

An importer may replace the root `project.id` when the imported identity collides with a project that cannot be overwritten. This creates a distinct project copy; entity and asset IDs inside the document remain unchanged so their internal references stay valid.

## Project-owned assets

`building.planScale` is the shared conversion from plan canvas units to metres. A valid scale
has a finite positive `pxPerMeter`, or two distinct finite reference points and a finite positive
`meters` distance. Reference points use `coordinateSpace: 'asset'`; their optional `floorId`
identifies the floor owning the asset-local ruler. Older references without that owner remain
accepted. Legacy PDF raster-coordinate references are repaired once during loading.

Calibrated imported plans are resized into the shared canvas units through asset `width` and
`height`; source raster pixels and SVG content keep their original resolution. CAD coordinate
metadata must describe the resized display coordinates. Recalibrating a floor preserves other
floors' physical dimensions by transforming their geometry, display assets, placements and traces.
Optional `building.floors[].planScaleNeedsCalibration: true` marks an imported plan with no known
distance. It must not supply accepted cable-length estimates until calibrated. Missing or false
preserves the historical behaviour. Confirming the displayed ruler, including its editable initial
value, applies that calibration. Only an explicit Skip leaves an imported plan uncalibrated; an
invalid or incomplete ruler cannot be confirmed. These optional fields do not change the schema
version or archive layout.

Floor-plan images, processed images, vectors, and local installer artwork are stored in the project fields that own them. Binary payloads use standard data URLs; SVG content may be stored as SVG text where the schema permits it. Readers must preserve unrecognized asset metadata but must not fetch or execute unknown content automatically.

Current writers externalize and hydrate floor-plan payloads through the native `assets` array and
the asset IDs referenced by `building.floors`. They also externalize imported diagram sources
and installer artwork. Historical inline floor payloads are converted to those containers
during import normalization; storage and ZIP asset adapters do not treat a top-level `floors`
array as a second runtime asset authority. Hosted and community readers use the same limits,
path rules, validation, and legacy repair behavior.

Attached documents use asset kind `document`. An entry either carries its own PDF or image payload
in `dataUrl` (with `mimeType`, `sourceName`, and optional `sizeBytes`), or has no payload and
annotates another asset named by `document.sourceAssetId`. The optional `document` object holds the
display name, a category, an export flag, an optional `exportPages` list of 1-based pages to
export (all pages when absent), links to electrical elements (`type` and `id`), and the time it
was added. Archives write payloads below `assets/project-<id>/documents/`. Readers in every
edition must preserve document entries, including ones they do not display. A document copied from
a hosted team library may carry an opaque `document.teamDocumentId`; readers preserve it and need
not interpret it.

A document entry without a payload and without `document.sourceAssetId` may instead carry an
external influences table in `document.externalInfluences`: a `rooms` list whose entries have an
`id`, a `name`, a `publiclyAccessible` flag, and `classes`, which maps two-letter AREI parameter
codes (`AA` to `CB`) to ascending lists of class numbers; several classes per code express a
combination such as `AA3+5`. Readers drop unknown codes and out-of-range classes. Writers may add a
spreadsheet copy of each table (`.xlsx`) under the same `documents/` folder. That copy is
informational: `project.json` stays the source, readers ignore it, and nothing references it. Copies embedded in an
exported PDF, and diagnostic or support copies, omit them; a project restored from such a copy
has no attached documents.

A document entry without a payload may instead carry `document.builtIn` and an
`includeInExport` flag. It stores only whether a view the project derives live and never stores
goes along with a PDF export: `"cableSchedule"` (the cable schedule, derived from the cables) or
`"controlAddresses"` (the domotica address table, derived from domotica modules and their
connections). Readers that do not know the value preserve the entry and ignore it.

CAD-derived floor plans use imported-plan asset kind `cad-vector` (distinct from PDF vector imports). When present, `cadReference` stores versioned source-coordinate metadata: source units, uncropped asset size, per-floor crop in both asset and model space, import-session linkage for multi-floor splits, and the forward/inverse transform parameters captured at import. Legacy projects imported before this metadata existed do not carry `cadReference`.

Floor-plan assets may carry two display flags: `darkModeAware` (adapt the plan when drawn in dark
mode) and, for vector plans, `grayscale` (draw the stored SVG in greyscale; `svgContent` keeps its
colours). Readers that ignore `grayscale` draw the plan in colour. Plans greyscaled at import by
older versions have greyscale `svgContent` itself and cannot be switched back to colour.

## Compatibility and normalization

The loader accepts:

- `2.3.0`, the current native format;
- `2.2.0`, upgraded by repairing the routes of seeded wire runs (see below);
- `2.1.0`, upgraded by seeding the canonical wire-run collection (see below);
- `2.0.0`, upgraded by adding the current scope contract, then seeding wire runs;
- `0.2.0`, migrated through the legacy V1-to-V2 importer, then seeding wire runs.

Other schema versions are rejected. New writers must emit the current version and serialize through `projectToStoredProjectV2`. Historical top-level electrical, floor, wiring, annotation, and quarantine fields are accepted only as legacy import input: loaders normalize them once into the V2 containers, and neither the editor runtime nor `project.json` carries runtime compatibility aliases.

Import validation requires, after normalization:

- a non-empty `project.id`;
- a `project` object;
- a floor array in the current or accepted legacy location;
- a panel array in the current or accepted legacy location;
- a structurally valid project according to `validateProjectStructure`.

A missing project name is repaired to a localized import fallback name. Obsolete oversized V2 documents containing the recognized legacy embedded-image shape receive a narrowly scoped migration exception.

## Import limits

The importer enforces these defensive limits:

| Limit          |   Value |
| -------------- | ------: |
| `project.json` | 20 MiB (160 MiB only for recognized legacy embedded-image documents) |

Archive producers should stay comfortably below these limits. Consumers must not trust paths, MIME types, dimensions, identifiers, or JSON properties merely because they appear in an archive.

## Change policy

Format changes must be forward-migratable and preserve existing local projects. A meaningful change includes adding or moving persisted fields, changing required defaults, changing asset-path behavior, accepting or rejecting a schema version, modifying archive entries used for loading, or changing an import limit.

Every such change must update this document and add or adjust community archive round-trip tests or the relevant migration tests.

Terminal strips physically placed in an auxiliary enclosure retain their original circuit occurrence and use `panelMounting: { kind: "auxiliary", enclosureId }`; their physical grid slot belongs to that enclosure. `terminalStripPanelId` remains the physical destination for ordinary electrical panel placement and is cleared for auxiliary placement. Moving a strip changes neither its circuit nor its electrical connections.
