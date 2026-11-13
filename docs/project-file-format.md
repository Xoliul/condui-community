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

The current schema version is `2.3.0`. Projects containing one-wire forks are
written as `2.4.0` (see [One-wire forks](#one-wire-forks)); all other projects stay `2.3.0`.

`project.showConduiBranding` optionally controls the drawing title-block footer:
missing or `true` shows the localized Condui attribution, `false` hides it.
`project.installerHeading` optionally replaces the localized installer column
heading with trimmed text (at most 80 characters); missing or blank uses the
localized default. These portable preferences apply to all drawing title blocks
and PDF pages when customization is available. Readers without support may use
the defaults and should preserve the preferences. No schema bump is required.

Canonical `disciplines.electrical.wireRuns[].route` accepts `"none"` as an explicit
absence of an installation-route marking. An omitted route inherits the upstream
route within the circuit/domain; `"none"` stops that inheritance without removing
the electrical connection, conduit setting or cable specifications. The other
values remain `"wall"` (in wall), `"on-wall"`, `"ground"` and `"air"`. Clearing an
override restores inheritance. Existing projects with omitted routes keep their
previous behaviour; no schema version change is required.

An omitted `wireRuns[].cable.fireClass` likewise inherits the upstream fire class
within the circuit/domain, and finally the circuit's cable fire class. The optional
`wireRuns[].fireClassNone: true` records an explicit "no fire class": the run's
`cable.fireClass` stays empty, downstream connections without their own class inherit
that absence, and validation still reports the class as unspecified. Choosing a class
removes the flag. Readers that ignore it fall back to inheritance; no schema version
change is required.

`disciplines.electrical.installation.connectionCurrentA` is an optional positive
integer in amperes: the rated incoming connection current per phase (the installed
connection-breaker setting). Missing means unspecified; readers must not infer
40 A or copy a downstream RCD rating. Clearing the field omits it. Older projects
remain valid and the value is independent of the domestic/non-domestic profile.
It is not a prospective short-circuit current or a network-impedance measurement.
New blank projects start with 25 A as an editable creation default; this does not
fill missing values when loading existing projects. Editing the connection setting
also updates an existing serial utility-side MCB before the meter in the same
transaction; it does not infer or resize downstream protection or conductors.

`disciplines.electrical.installation.labelScheme` is an optional object that
describes how automatic labels are formatted: `version` (`1`), `separator`
(`"."`, `"-"` or `"/"`), `panel` (`prefix` text without spaces or digits, at most
6 characters; `style` `"number"`, `"number2"` or `"upper"`; `start` `0` or `1`;
`nested` boolean), `circuit` (`style` `"upper"`, `"lower"`, `"number"` or
`"number2"`; `panelPart` `"none"`, `"number"`, `"full"` or `"continuous"`; `joinPanel` boolean)
and `branch` (`join` boolean). Wherever two numbers meet, the separator is always
written. Missing or invalid means the classic scheme (circuits `A, B, C`,
branches `A1`, domotica outputs `A1.1`, panel numbers `B01`), and the classic
scheme is saved by omitting the field. Labels themselves stay stored on circuits,
protections, branches and endpoints; the scheme only decides how automatic naming
rewrites them. `panelPart` values `"number"` and `"full"` take effect only while
`panelNumberingEnabled` is true. `"continuous"` omits the panel prefix and
continues the circuit sequence across boards in panel order (each board followed
by its sub-boards), reserving manually locked labels across the installation.
It works with panel numbering off; board numbers can still be displayed independently. No schema bump is needed; readers without support keep producing classic
labels.

A panel may carry an optional `numberOverride` string (1–12 characters), a panel
number typed by hand. While panel numbering is on it replaces that panel's
automatic code (and the number part used in circuit labels, without the scheme
prefix when it starts with it); the panel keeps its place in the automatic
sequence, so other panels keep their numbers. Missing means automatic.

Transformer devices may optionally persist positive finite nameplate values on
`conversionProps` (trunk devices) or `energyConversionProps` (endpoints):
`transformerPrimaryVoltageV` and `transformerSecondaryVoltageV` in volts
(line-to-line for three-phase units), `transformerRatedPowerKva` in kVA, and
`transformerShortCircuitVoltagePercent` (`uk`) in percent, greater than zero and
at most 100. Missing values are unspecified, and clearing a value omits it.
Legacy text fields remain accepted and preserved independently. A transformer
added to the supply wire is an ordinary serial AC/AC trunk device; it does not
create an inverter/backup supply assembly, change the installation profile or
resize downstream devices. No new schema version is required for these optional
fields. Older projects without them remain valid.

An optional `conversionProps.transformerRole: "supply"` on a common serial
transformer identifies the installation's medium-voltage source transformer.
There is no second copy of its nameplate in project metadata. The installation's
`nominalVoltage` remains the low-voltage output; changing it updates the marked
transformer's secondary voltage in the same transaction. A marked transformer's
known primary voltage must exceed 1,000 V, and its secondary must match the
installation's line-to-line voltage. Choosing Own transformer initializes an
editable 10,600 V primary and the selected LV output; kVA and uk remain unknown.
Missing roles preserve legacy/generic transformers without inferring nameplates
on load. Explicitly choosing Own transformer can adopt an existing common
transformer and move it before the LV meter/protections. No schema bump is needed.
Returning to Direct low voltage removes only marked supply transformers; generic
and panel-local transformers remain independent.
Marked supply transformers are external equipment: panel-grid slots, mounting
and explicit visibility choices cannot place them in a cabinet. Their one-wire
supply frame stays separate even while the receiving panel has no circuits.
With a marked supply transformer, `connectionCurrentA` is the LV connection
setting: it updates the first LV MCB after that transformer, never MV protection
before it. The MV source label does not display the LV current as primary current.

A site with a marked supply transformer may run main panels at different LV
systems (for example one transformer with two taps feeding a 3N~ 400 V and a
3~ 230 V main panel). The primary record of
`feedTopology.rootFeeds[]` for that main panel may then carry an optional
`nominalVoltage` with the same shape as the installation's. It is effective only
while a marked supply transformer exists; the main panel's sub-panels, circuits and
phase choices inherit it. Missing means the installation's `nominalVoltage`, which
stays the default output. Every bus-section feed of one main panel carries the
same value. Only a main panel directly behind the transformer (a top-level panel
not fed from another panel's protection) uses this value; on any other record it
is ignored and the panel follows the panel that feeds it. The first such panel
runs on the installation's `nominalVoltage`: editors change the default output
through it and give the other direct main panels an explicit value so they keep
their output. `conversionProps.transformerSecondaryOutputsV` is a drawing-only
view of every output and is not written to projects; readers ignore it. The same records may carry optional `transformerOutputRatedKva` and
`transformerOutputUkPercent`: the nameplate of the winding behind that output, used
for its fault level. They exist only beside `nominalVoltage`; the transformer
device's own nameplate describes the installation's output. Returning the panel to
the installation voltage clears all three, and removing the supply transformer
through Direct low voltage clears these fields on every panel. Older readers
preserve the fields but treat every panel as running at the installation voltage;
no schema-version change is required.

Meters and protections placed before a marked supply transformer on the common
supply wire are on its medium-voltage side (for example a single MV meter).
Choosing Own transformer again keeps them there; only other devices are moved
behind the source.

The project locale supports `nl-BE`, `en`, `fr-BE`, `de`, `pl`, and `ro`.
Electrical JSON imports accept the same locale codes. Dutch remains the default.

Missing protection ratings and residual-current types are unspecified. Readers
must not fill an absent breaking capacity or residual-current type from creation
defaults. Legacy supply protections with only a known `breakingCapacityOption`
or `breakingCapacityKa` may derive the matching representation. Explicit capacity
clears remove both fields; clearing another rating omits that field. New device
creation may still provide editable defaults. No schema version change is required.

RCD and RCBO protection records (including supply and circuit trunk devices) may
persist `selective: true` for selective, time-delayed S-type protection. Missing
or `false` means ordinary protection. This is independent of the waveform class
`residualCurrentType` (AC, A, F or B). Older projects remain valid without the
optional boolean; no schema version change is required.
The independent optional `superImmunized` boolean marks super-immunized protection
with `SI`; missing or `false` leaves that designation off. Both flags can be set.

An MCB protection may carry optional `tripSettings` with the adjustable settings of a
moulded-case or air breaker, in amperes and seconds: `irA`, `isdA`, `tsdS` and `iiA`, each
optional; their presence means the breaker is adjustable and its labels omit the curve letter,
while `curve` keeps the previous curve. A FUSE protection may carry `fuseClass`, `"gG"` or
`"aM"`. Missing means unknown. A protection on the incoming supply wire
(`installation.mainSupply.supplyTrunkDevices`) may carry the same two fields. Neither field
changes cabinet layout; readers that do not calculate fault levels preserve them and may
ignore them. No schema version change is required.

`project.lastViewportLayout` may repeat the same canvas type in multiple slots.
For the `grid` preset, optional integer `rows` and `columns` each range from 1 to 4;
the layout contains `rows × columns` panels, in row-major order. Omitting both
dimensions preserves the legacy resizable 2×2 grid. Detached windows, their screen
positions, and individual slot cameras/document viewers are session state and are
not serialized into the portable project. No schema version change is required.

Plan-wiring visibility may include `wireToolCategoriesVisible`, an optional map of
`lighting`, `sockets`, `devices`, `feeders`, `supply`, `dc`, `earthing`, and `other`
booleans. It filters colour groups while the wire tool is active; omitted groups are
visible. Its optional master switch, `wireToolWiresVisible`, defaults to visible and
is independent of the ordinary `wiresVisible` switch and situation-plan filters.
Older projects without these fields remain valid. Entering the wire tool enables
only its own master switch and resets the map so every colour group starts visible;
changes apply until the next entry. Leaving the tool uses the unchanged ordinary
situation-plan visibility settings.

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

Elements can carry a `scopeId` identifying their portable domain, including
`shared-building`, `electrical`, and `coordination`. Missing legacy scopes are derived
from the element's layer/system during loading. New building geometry and plan notes
write the corresponding scope immediately so saving and reopening preserves their
canonical representation. This does not change the schema version or reject older files.

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

`disciplines.electrical.installation.earthResistanceOhm` may hold the earth-electrode
resistance in ohm, and a panel may hold `expectedShortCircuitKa`, the expected maximum
short-circuit current at that board in kA. Both are optional positive numbers; missing
values mean unknown, and older files without them remain valid.

A switch endpoint may use `symbol: "light_sensor"` for a twilight switch
(ambient-light-operated contact). It uses the existing switch endpoint and plan
placement shapes, with no new properties or schema version. A circuit trunk
device may also use `type: "switch", symbol: "light_sensor"`; its existing
`trunkPosition` places the contact before the branch at that index, so that branch
and all following branches share its switched supply, including any downstream
motion sensor. A branch-local twilight switch controls only that branch. Existing
projects remain valid; TRiK twilight switches retain this symbol on import.

<a id="one-wire-forks"></a>**One-wire forks.** An ordinary AC final-circuit `Branch` may persist `forkFrom: { "afterEndpointId": "<id>" }`.
The branch is then fed from the downstream connection of that endpoint in the same
circuit instead of from the circuit trunk, so its cable runs from that endpoint.
Forks may nest to any depth: the referenced endpoint may itself sit on a forked
branch. A branch without `forkFrom` remains a root branch fed from the trunk, and
trunk device `trunkPosition` indexes count root branches only. `keepEmpty: true`
keeps a deliberately created branch with an empty `endpointIds` list; without it,
empty branches are dropped during normalization. A circuit may hold forks next to a
branch-local converter endpoint (`transformer`, `rectifier`, `inverter`, `dc_dc_converter`):
the root branch holding the converter, and any legs below it, is written exactly as
without forks, and no `forkFrom` references an endpoint in it. Readers must keep such
roots intact and may treat a `forkFrom` into one as an unresolved connection.

A document containing any `forkFrom` or `keepEmpty` is written with schema version
`2.4.0` so that readers that do not understand fork attachments reject it rather
than silently flattening the topology. Once written as `2.4.0`, a project keeps that
version. Readers must not invent attachments: a `forkFrom` that references a
missing endpoint, an endpoint in another circuit, or forms a cycle is reported as an
unresolved connection, its endpoints are retained, and no electrical feed is derived
for that branch.

Branch and endpoint labels are stored values and are kept as written. The editor
labels a leg like the branch it hangs from when a switch feeds it. A leg attached
directly after a `switch_1p_changeover` endpoint, or after a point on its branch that no
switch feeds yet, gets its own sequential branch number (later root branches shift up);
readers must not recompute either.

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

`switchProps.protected` optionally marks a `switch_impulse` pushbutton with a
protective break-glass cover. Missing or `false` means an ordinary pushbutton.
It combines with `switchProps.verklikkerlamp` (indicator light), changes only the
artwork, and requires no schema-version change. Readers without this drawing
option should preserve it.

Control addressing records which channel of a building-control device (KNX, DALI,
Loxone, Niko Home Control or Qbus) feeds a load. It is descriptive only: addresses are labels for
the installer and integrator, never programming data. Every field below is optional;
missing means unspecified, and older files remain valid.

Both kinds of connection share one addressing shape, `{ channel?, groups?, buttonAddresses? }`. `channel`
is a free-text physical channel (`C`, `5`, `Q7`); readers accept a legacy JSON number and
treat it as its decimal string, and compare channels trimmed and case-insensitively.
`groups` is a list of free-text logical addresses (KNX group addresses `1/2/3`, DALI
groups `G1`); readers trim entries, drop blanks and ignore case-insensitive duplicates.

`buttonAddresses` optionally holds sparse per-button overrides as
`{ buttonIndex, channel?, groups? }` records. `buttonIndex` is a unique zero-based
nonnegative integer. The drawn button count is the existing
`switchProps.switchingCount` on `switch_impulse` endpoints (one when absent);
other input symbols have one button. An override replaces both addressing fields
for that button, so an explicit `{ buttonIndex: 0 }` clears the first button's
address without deleting legacy scalar data. When no override exists for index 0,
the scalar `channel` and `groups` remain that first button's address. Additional
buttons never inherit that address. Unconfigured additional buttons do not create
virtual address-table rows. Readers preserve overrides beyond the current count,
but exclude them from drawing, channel claims and the address table until the
count grows again. Input and output channel namespaces remain separate.
Duplicating an endpoint clears physical channels on every stored button,
including inactive ones, while preserving group addresses and the device link.
No schema-version change is required; older projects without overrides keep
their previous first-button addressing.

- An endpoint may persist `controlLink: { deviceId, channel?, groups?, buttonAddresses? }` as a virtual
  "operated by" relation. `deviceId` is the id of a domotica module endpoint (an endpoint
  with `symbol: "domotica"` and no `domoticaChildProps`) or of a relay endpoint
  (`symbol: "relay"`, e.g. an impulse relay whose coil sits on a control circuit). The UI offers the link on
  contacts, input switches and relay endpoints. A relay can receive a control link
  while continuing to operate its contacts; self-links and cycles are rejected.
  The link carries no topology: it adds no wire and no panel module.
  On the one-wire diagram a valid output link replaces the endpoint's own notes (and
  `notesVisible`) with `<device label> · <channel>` (just the device label without a
  channel); a dangling link falls back to the endpoint's own notes.
- An endpoint wired to a module (`domoticaChildProps`) may persist `channel`, `groups` and `buttonAddresses`
  with the same meaning.
  Input buttons show their configured addresses beneath their symbols. Linked
  inputs retain their own notes; existing wired-child note visibility is unchanged.
  A multiplied impulse switch keeps its count marker and shows
  numbered addresses for the configured active buttons.
- Output rows of a module are labelled `{module label}.{n}` by default. The root endpoint of a
  row (the id in the module's `domoticaProps.endpointChildEndpointIds`) may persist
  `domoticaRowLabel` as either `{ kind: "tail", tail }` (row label is the module-derived
  label followed by `tail`, so it follows module renames) or `{ kind: "literal", text }`
  (row label is exactly `text`). Every endpoint on that row shows the resulting label.
  Absent means the automatic label. Showing the row label on the diagram can be turned off
  with `symbolLabelDisplay.visibility.domoticaRowLabel = false` on the same root endpoint.
  Readers ignore an invalid override.
- An output may feed another panel through a `panel_distribution` endpoint with
  `panelId` referencing that panel and `domoticaChildProps` identifying the module
  and output row. The receiving panel remains nested under the source panel.
  Its endpoint label retains the panel name; the output reference is derived
  independently from the module and row. Other loads may share that output.
  This is not a whole-circuit feed: the upstream protection's `subPanelId` stays
  absent. Existing endpoint fields carry the connection; no schema bump is required.
- A domotica module (`domoticaProps`) may persist device fields: `system` and, for a
  gateway, `outputSystem` (each one of `knx`, `niko_hc`, `dali`, `loxone`, `qbus`, `other`),
  `deviceAddress` (free text, e.g. the KNX physical address `1.1.12`), `line` (free text,
  e.g. a DALI line) and `channelCount` (positive integer physical output capacity,
  independent of the drawn `endpointCount`). Wired switches, pushbuttons and detectors
  are the module's inputs and linked endpoints and other wired children its outputs;
  inputs and outputs are numbered independently and inputs never count against
  `channelCount`.

An existing domotica output row can optionally be a physical bus. Its record in
`domoticaProps.endpointOutputWires` or `controlOutputWires` may persist
`connectionType: "bus"`, `busName` (free text), `busSystem` (one of `knx`,
`niko_hc`, `dali`, `loxone`, `qbus`, `other`) and `showBusLabel` (boolean).
Absent `connectionType` retains the ordinary switched-output behavior; this does
not rewrite the cable or create a second connection graph. All chained children
with the same `parentEndpointId`, `outputGroup` and `outputIndex` share that bus.
The effective protocol is `busSystem` when entered, otherwise the parent module's
`system`, never its `outputSystem`. A bus name does not establish identity between
different rows. `showBusLabel` defaults to true while bus mode is active and has
no effect on a standard row. The displayed label combines an entered name with
the protocol; absent both, it is `BUS`.

A native device on that bus may persist its own
`busDeviceProps: { deviceAddress? }` on the endpoint. The physical address is free
text, is never inherited from the parent, and is independent of its existing
`domoticaChildProps.channel`, `groups` and per-button overrides. Those channels
are local to the device, so different devices on a bus can both use channel `T5`.
Repeated channels on one device remain findings; repeated group addresses are
allowed. A known KNX bus enables physical-device and group-address syntax
warnings. Physical-device addresses must be unique only within that physical bus
row, and one multiplied pushbutton is one physical device for that check. Native
bus devices do not consume the host's switched-output channel capacity. A nested
domotica module retains its own output rows and capacity while its physical
identity belongs to the parent bus.
Duplicating a native bus device clears its physical `busDeviceProps.deviceAddress`
alongside its physical channel assignments. Bus-row configuration and logical
groups/functions remain intact; a complete module copy applies the same rule to
its copied child devices without changing the source objects.

Removing bus mode preserves the optional metadata and native device identities
but makes them inactive; the row resumes its ordinary output checks. Clearing an
optional field omits it. `qbus` is also accepted in module `system` and
`outputSystem`. These optional fields need no schema-version change; older files
without them keep the existing behavior.

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
A board `gridView` may carry an optional integer `fields` (default 1, at most 8) for a
multi-field cabinet or several cabinets side by side. Every field has the same `rows` and
`columns`; field `i` (from 0) starts at module column `i * (columns + 2)` of one global grid,
so slot `col` values keep a single coordinate system and the two empty columns between
fields are a gap. A module never straddles a field boundary. Files without `fields` have one
field, and a loader that ignores `fields` keeps the modules at their stored positions.
Automatic slot persistence retains the rail marker. When older automatic slots contain
overlapping distinct terminal strips in a regular row and a terminal rail is enabled,
the editor recovers those strips onto free terminal-rail positions.

A circuit terminal-strip occurrence may persist `terminalStripPanelId`, identifying the
physical panel-canvas frame that contains the strip. This value is independent from the
occurrence's circuit and one-wire ownership. Occurrences with the same `junctionIdentity`
represent one physical strip and move together; missing values retain the historical
behavior of showing the strip on its circuit-owning panel. A strip stored as an endpoint
(`symbol: "terminal_strip"`) may persist the same `terminalStripPanelId` on the endpoint; it
moves together with trunk-device occurrences of the same `junctionIdentity`, but has no
auxiliary-enclosure mounting.

Relays, energy meters, energy converters and domotica modules may hang outside the panel
that owns their circuit. A circuit trunk device of that kind persists the physical location
in its existing `panelMounting`, and an endpoint with a panel-module symbol (`relay`,
`energy_meter`, `domotica`, `transformer`, `rectifier`, `inverter`, `dc_dc_converter`), or a
socket endpoint with `socketProps.modular: true`, may persist the same field on the
endpoint. Modular sockets retain their derived two- or four-module width. Only
`kind: "panel"` (a distribution panel, including the circuit's own panel) and
`kind: "auxiliary"` (an auxiliary enclosure, which then needs no supply devices) apply; a
missing value uses the default enclosure along the circuit: a preceding junction panel,
or otherwise the circuit's own panel. An explicit mounting on the owning panel takes
precedence over that junction-panel default. Its grid slot belongs to the target frame. A
target that no longer exists falls back to the owning panel, and deleting an auxiliary
enclosure clears the mounting of the modules it held. Mounting never changes the circuit,
device order or electrical connections; readers that ignore it show the module in its own
panel.

Panel label editing is module-owned rather than slot-owned. Protection devices, endpoints,
and trunk devices may contain an optional `labelNotes` string and optional `panelLabel`
configuration with `top` and `bottom` cell sources and optional `left`, `center`, `right`, or
`justify` alignment. Each cell retains a singular `source` for compatibility and may contain
an ordered `sources` array; multiple sources render on separate lines. Each source is one of
`label`, `notes`, `labelNotes`, `technical`, or `feeds`. The optional `feeds` source derives
downstream circuit codes and descriptions from electrical topology; next to `label`, it
uses compact code ranges. It stores no second copy of those circuits. Missing configuration defaults to Extra (`labelNotes`) in
the top cell and combined `label` plus `notes` in the bottom cell; `labelNotes` is not inferred from other
values. Editing a linked cell stores the edited text in `labelNotes` and changes that cell's
source to `labelNotes`. The label export uses the bottom cell for single/on-row strips and
exports the top and bottom cells separately for double-strip output. An optional boolean
`panelLabel.main` overrides whether the module is printed as its board's main protection;
when it is missing, readers derive that from the electrical topology.

Junction-panel trunk devices may persist `junctionPanelGridView`. It stores the shared
panel-canvas rows, columns, feed direction, module slots (including manual widths), and optional top or bottom terminal rails
for the physical junction panel identified by `junctionIdentity`. Occurrences with the
same identity represent one enclosure and receive the same grid configuration. Missing
configuration defaults to one row and 18 columns.
Module slot rows start at zero below the terminal row when no terminal rail is enabled.
Moving a module out of the junction panel removes its old shared slot and preserves its
manual width in the destination enclosure.

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
vertical input leg, and `"converter-leg"` places it on that leg above a changeover
grid tap (see below). A `"changeover-grid"` device is inline on the lower horizontal
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

An endpoint or trunk device may persist `metadataCalloutOffset` as `{ "x": number, "y": number }`:
the user-dragged top-left corner of its one-wire metadata card, relative to the rendered
centre of that symbol. A card shared by several identical targets stores it on its first
target. Missing or malformed values use automatic card placement.

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
`terminalStripPin` stores the positive circuit group number. The combined display is
therefore `X1-3`. New occurrences default to strip `X1`: all occurrences on the same
circuit and strip reuse one number, including both connections of an in-line trunk
and any outgoing branches. Another circuit receives the next free number on that strip.
A group can contain several conductively isolated terminals; the group label alone
never joins its conductors. Individual conductor connections belong to the detailed
junction wiring model.

An in-line trunk occurrence may additionally store `terminalStripOutgoingPin`. It
defaults to the incoming group number when absent; equal numbers display once as
`X1-3`. Explicit different numbers remain accepted and display as `X1-3/4`.
`terminalStripPin` remains the sole number for an endpoint occurrence. These fields
are owned by the canonical V2 electrical device occurrence and do not create duplicate
physical strip identities. Manual numbers are preserved without renumbering peers.
Using one strip/group number across different circuits produces a validation error,
including an explicit outgoing number. Gaps are valid and existing numbers are never
renumbered on load. Legacy combined identities such as `1-3` remain accepted and are
split when edited.

Junction boxes, junction panels, and terminal strips may persist `junctionIdentity`.
Equal identities on occurrences of the same symbol identify one shared physical
junction while each occurrence retains its own electrical circuit position. Endpoint
`label` remains branch-owned automatic naming and does not replace this identity.

Junction-panel situation-plan locations are stored in the optional
`disciplines.electrical.installation.junctionPanelPlacements` collection, matched by
`label` to the panel's junction identity (ignoring case and surrounding whitespace).
These records contain drawing locations, not electrical connections. The editor
removes stale locations on opening a project and when deleting the last occurrence
of a junction panel, including deletion of its containing circuit, protection or
board. A location shared by surviving occurrences is preserved. This repair does
not change the schema version.

Hosted editions may also write `junctionAssetId` on these occurrences and the collections
`disciplines.electrical.junctionAssets`, `terminalRails` and `terminalShapes`. They describe
the physical junction behind the occurrences and its connections. Other readers treat them as
opaque compatibility data: they keep the collections and the occurrence field unchanged when
saving, also when they edit, copy or delete occurrences, and never use them to change how
`junctionIdentity` and the pin fields are read.

A junction asset may name the junction-panel terminal it belongs to (the `id` of an
occurrence's `junctionPanelTerminal`, or the id a reader derives when that field is absent).
This is part of the same opaque data: `junctionPanelTerminal` and `junctionPanelGridView`
are still written and read exactly as described above, and readers that do not use the
assets need not resolve the reference.

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

An ordinary endpoint belongs to one circuit branch. When opening older projects,
the editor repairs the historical inline-insertion defect where the same endpoint
was referenced by the first branch and exactly one later branch: it removes the
first-branch copy and retains the later branch's reference. If several later
branches reference that endpoint, the editor preserves the ambiguous references
for manual review. This repair does not change the schema version.

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
circuit that owns that secondary busbar. Each order contains three line-phase entries;
phases may repeat. For example, `L1`, `L2`, `L1` assigns successive two-pole devices in
`3N~` to `L1+N`, `L2+N`, `L1+N`, `L1+N`, `L2+N`, `L1+N`, and so on.
Missing or invalid orders use `L1`, `L2`, `L3`.
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
line phase for a single-phase bus in a multi-phase installation. Three-entry orders
allow repeated phases, just like `busbarPhases`; shorter orders describe available
line phases and contain no duplicates. Missing
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
The same applies, without a changeover, to an assembly attached at a panel's input:
its generated handoff back to that panel's normal bus
(`<assemblyId>-panel-load-<panelId>`), fed only by the assembly's utility source over
`grid-only-bypass-ac` connections, is the panel's own grid input and not a second supply.
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
The changeover record may persist `changeoverGridSource`: missing or `"grid"` taps its
grid input from the grid run as described above; `"converter-input"` taps it part-way
up the inverter's grid-input leg instead. That choice is effective only when the panel
has both a normal and a backup bus section and the inverter's grid input is connected;
otherwise readers treat it as `"grid"` and keep the value. With the converter tap,
`converter-grid` devices with `converterGridPlacement: "input-leg"` are serial below
the tap and feed both the inverter and the changeover grid input, `"converter-leg"`
devices are serial between the tap and the inverter grid input only, and
`changeover-grid` input-leg devices are serial between the tap and the changeover's
grid port. The assembly graph then contains an `ac-distribution` node with id
`<assemblyId>-converter-input-split`, and the changeover's grid-input path carries the
inverter's AC conductors. With the grid tap, `"converter-leg"` devices are serial on the
inverter grid input after the `"input-leg"` devices, so switching the source never
reassigns devices. Leg devices are ordered by `trunkPosition` from the grid side toward
the inverter.
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
function, optional per-core section), an optional `medium` (`cable` or `busbar`),
optional run-wide `material` (`copper` or `aluminium`) for either medium,
`busTapLengthMode` for busbars, route/tube flags, per-member `segmentLengths`
in metres, and `members`: stable anchor keys (not relationship ids) of the edges sharing the
run. The optional `segmentLengthSources`, keyed like `segmentLengths`, marks a length with
`'estimated'` when it was accepted from a plan-based route estimate rather than entered; a
missing entry means an entered length. Recalibration invalidates accepted estimates with
`'estimated-stale'` and removes their numeric `segmentLengths` entry. This marker may therefore
remain without a length until the estimate is reviewed. Readers must not use a stored length
marked stale for electrical checks. Older readers see a missing length. An explicit length edit
or renewed acceptance replaces the stale marker; manually entered lengths are preserved.

Missing `material` means copper. The material applies to every core in the run;
it cannot describe aluminium phases with a separate copper protective conductor.
Cable material uses the existing optional field without a schema-version change.

Each entry of `conductors` is one physical core. Its `function` is one of `L1`, `L2`, `L3`,
`N`, `PE`, `Lsw` (switched phase), `T1`/`T2` (travellers), `ctrl`, `sig` (one member of a
signal pair) or `spare`; readers that do not know a function keep the entry unchanged. A core
may carry an `id` (stable within its run and unique there), `colour`, `marking`, `assignment`
(`port`, `traveller`, `group`) and `signal` (`pair`, `member` `a`/`b`, optional `polarity`).
The `id` stays the same when the run's conductor list is rebuilt after a cable or phase change,
as long as a core with the same function and assignment still exists; a removed core's id is
never reused. Cores without an `id` (projects written before core identity, or by an older
reader) receive one on load, derived deterministically from the run id, the core's function and
assignment, and its ordinal among identical cores, so independent upgrades of the same project
produce the same ids. Readers must preserve ids and the other core fields when they save, and
copy them unchanged when a run is split into two.

When a member anchor moves from one run into another (for example when branch cables are
folded into a shared trunk cable), the surviving run keeps its own core ids and may record
`coreAliases[anchor]`: a map from the member's former core ids to the surviving run's cores
with the same function and assignment. A reference to `(anchor, coreId)` resolves to the core
with that id, else through this alias. Cores without a unique counterpart get no alias. When a
member leaves a run again, its aliases leave with it.

A run's optional `labels` object holds display flags: `hideWireLabel`, `showFireClassLabel`,
`showWireLengthLabel`, `showConductorMarks` and `showBranchConductorMarks`. When
`showConductorMarks` is `true` the one-wire and structure views draw IEC 60617 conductor tick
marks on that run's own members only; downstream connections keep their own runs and flags.
A run whose one-wire drawing has a vertical stem and a horizontal first branch draws marks on
the stem for `showConductorMarks` and on the branch for `showBranchConductorMarks`; the
structure view marks the run when either is set. Busbar runs drop `labels`. Readers that do
not know a flag ignore it.

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
A manual `lighting-control` trace may connect a switched light to the entry switch of a
separate branch in the same circuit. Such a trace has no `branchId`: it fixes the physical
feed between the two branches and does not merge their switch/light control groups. Readers
preserve these traces while rejecting directed feed cycles. Connecting an unassigned singleton
light to a switch instead changes the ordinary branch `endpointIds`; no extra scan-only
connection model is stored.

`disciplines.electrical.planWiring.visibility` may also carry optional cable-routing settings:
- `homeRunsVisible`: wires from the board to the first point of a circuit (absent means off).
- `branchFeedsVisible`: wires linking lighting branches (absent means off).
- `supplyVisible`: supply cables (inverter, solar panels, batteries) and earthing conductors
  (absent means on).
- `colorCoded`: colour plan symbols and ordinary plan wires (absent means off).
  The wire tool still colours wires by group independently.
- `symbolColors`: optional map of `sockets`, `lights`, `switches`, `panels`,
  `fixedAppliances`, `dc`, `energyConversion`, `earthing`, and `other` to
  six-digit `#RRGGBB` colours. Missing/invalid entries use the established wire palette: blue sockets, orange lights/switches, pink boards,
  ochre appliances, red DC, purple energy conversion/supply, green earthing,
  and grey other symbols. Pure DC symbols (solar panels, batteries and DC/DC
  converters) use `dc`; mixed-domain converters and transformers use
  `energyConversion`. Supply, DC and earthing wires use those same palette entries;
  other wires use their destination symbol category, falling back to their cable
  group or wire kind. These settings affect the plan and its export only;
  one-wire and panel drawings keep their normal theme colours. Older projects remain valid;
  no schema version change is required.
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
are opaque to external readers. Adding the first device to an empty protection output moves
its authored open-end run to the device connection, preserving its cable, routing, conductors,
labels, core aliases and per-connection length data.
When an ordinary branch's first endpoint is deleted, its authored incoming run moves to the next
remaining endpoint in that branch, preserving those same per-connection fields, unless that
endpoint already has a separately authored run. Inserting an enclosing protection moves the
existing device connections to their new circuit anchors, together with their member records,
plan traces and junction references. New input connections created by inserting or moving a
branch head, adding a branch, or clearing all loads retain the previous circuit input's cable,
routing and label settings only when all its incoming branch connections agree. These are new
runs with new conductor ids; lengths, core aliases and core assignments are not copied. An empty
output retains those settings as a preset for its next device. Independently authored destination
runs are never overwritten, and mixed branch settings do not become an arbitrary circuit default.
Matching settings on separate runs may be drawn on their common stem without merging the runs.
Removed device connections lose their obsolete member records. Converter and module-output
connections keep their specialized ownership and domain rules. Older node-pair anchors for shared supply-feed edges
are rewritten to their canonical feed anchors on opening or saving, retaining run
membership and per-segment lengths. A circuit anchor whose stored domain no longer matches its
device (a converter was added or removed upstream) is moved to the anchor with the current
domain on opening, saving and editing, together with its run membership, per-segment lengths
and length sources, core aliases, plan-trace `wireAnchor` and junction references, unless
another run already holds that anchor. Repeated drawing pieces share an anchor. Each connection
ends at the next device, including inline contacts, terminal strips and motors. Editing one
connection splits its anchor from an older multi-member run when needed, retaining the original
specification for the remaining members and preserving conductor identities, core aliases and
per-connection length data. Explicit edits of a drawn shared stem may group the incoming
connections to the first device on each branch; devices farther along those branches stay
independent. Busbar runs may contain several tap anchors, and a feeder drawn on two boards
retains its shared specification. Editing `segmentLengths[anchor]` changes only that connection.
Missing fire class, route and tube fields inherit from the preceding connection in the same
circuit and electrical domain, then from the circuit defaults. A downstream run can override
any of these fields independently; an unrelated cable-section edit does not remove inheritance.
Clearing an optional field resumes inheritance. Branches inherit their upstream trunk, and
module outputs inherit the module input rather than another output's overrides. Inheritance
stops at domain changes and circuit boundaries. An AC-to-AC transformer retains these
installation defaults; it does not make its secondary connection DC. Cable dimensions, conductor
identity, lengths and run membership are not inherited or merged by this rule. The effective
values are used consistently for properties, drawings, export and validation.
Empty or unknown legacy wire owners
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

An uploaded image or PDF document may carry `document.oneWire`, which shows it as a reference on
the one-wire canvas (scanned one-wire pages are imported this way, and documents dragged onto the
one-wire become schematics with it). Its optional members are `placements`, mapping a 1-based page
number (`"1"` for an image) to that page's top-left corner `x`, `y` and displayed `width` in
one-wire canvas units (pages keep their aspect ratio; readers place pages without one next to the
document's placed pages, otherwise above the diagram); `hiddenPages`, the page numbers taken off
the one-wire; `levels` and `highPass` enhancement strengths from 0 to 2 (default 1, both 0 draws
the page as stored); `opacity` from 10 to 100 (default 35); and `blend` (default false: when true
the paper is left out and the ink follows the canvas theme). Early files may hold an image's
placement as top-level `x`, `y` and `width`, read as page 1. Removing the object takes the
document off the one-wire and keeps it. Readers that do not show references preserve the object;
it is never part of an export.

A document entry without a payload and without `document.sourceAssetId` may instead carry an
external influences table in `document.externalInfluences`: a `rooms` list whose entries have an
`id`, a `name`, a `publiclyAccessible` flag, and `classes`, which maps two-letter AREI parameter
codes (`AA` to `CB`) to ascending lists of class numbers; several classes per code express a
combination such as `AA3+5`. Readers drop unknown codes and out-of-range classes. Writers may add a
spreadsheet copy of each table (`.xlsx`) under the same `documents/` folder. That copy is
informational: `project.json` stays the source, readers ignore it, and nothing references it. Copies embedded in an
exported PDF, and diagnostic or support copies, omit them; a project restored from such a copy
has no attached documents.

A document entry without a payload may instead carry `document.shortCircuit`, written by the
hosted editor for a calculation document. It holds that document's own inputs and frozen copies
of issued revisions; everything else it shows is derived from the project. Readers that do not
offer the calculation preserve the object unchanged and need not interpret it.

A document entry without a payload may instead carry `document.builtIn` and an
`includeInExport` flag. It stores only whether a view the project derives live and never stores
goes along with a PDF export: `"cableSchedule"` (the cable schedule, derived from the cables) or
`"controlAddresses"` (the domotica address table, derived from domotica modules and their
connections). Readers that do not know the value preserve the entry and ignore it.

### Room-scan reference documents

Room scanning may add two independent `kind: "document"` assets. Their optional
`document.roomScan` metadata contains `version: 1`, `kind: "model" | "placements"`, a
shared opaque `scanId`, the target `floorId`, the scan name in legacy field `roomName` (the floor name for floor scans), and optionally a
`relatedDocumentId`. Removing one document must not remove the other or the electrical
entities. Unknown document types remain portable assets even in readers without a viewer.

Both payloads are JSON carried by the asset's `dataUrl` with MIME type `application/json`.
The normal document asset externalization writes them below the existing `documents/`
archive directory; reference JPEG crops stay inside the placement document's payload.
No new archive or project schema version is required. They are source/reference material
and are not PDF annex pages.

- A model payload has `version: 1`, `units: "meters"`, `parts`, and `capturedRoomJson`.
  Each part has an opaque `id`, `kind` (`wall`, `door`, `window`, `opening`, `floor`, or
  `object`), `dimensions: { x, y, z }` in meters, and a 16-number column-major local-to-world
  `transform`. Object parts may additionally carry `category` and `confidence` strings
  from RoomPlan. Missing values remain valid for older scan documents. `capturedRoomJson` preserves the original captured-room JSON as an opaque
  string. The viewer accepts up to 3,000 parts and a 3,000,000-character original JSON.
- A placement payload has `version: 1`, `units: "meters"`, and up to 80 `entries`. Each
  entry has the original observation `id`, a library `symbolId`, raw world `position`
  and surface `normal` (`{ x, y, z }`), `quantity` (1–4), and optionally `photoDataUrl`
  (a JPEG data URL, at most 160,000 characters). It also records `target: { type, id }`
  (`endpoint` or `panel`), `placementId`, optional `circuitId`, the imported plan `pos`
  in canvas units, the captured `heightCm`, and optionally `rotationDeg`, detected
  `roomId`, and the accepted `roomName`. Target identity stays stable across
  renaming and circuit moves. A removed target leaves the reference evidence intact.

Scanned fixtures are ordinary electrical endpoints and plan placements. Socket-bank
quantity uses `socketProps.socketCount`; a two-way or cross switch is one recorded
physical endpoint, with no inferred companion switches or control links. Panels remain
normal panels with their panel-symbol endpoint. Source coordinates and photo crops do
not create a plan-only electrical entity class.

Generated circuits may carry optional `scanReview: { scanId, roomName }`. This marks
provisional room/type organization whose electrical connections and cable settings have
not been confirmed. New scan groups use the same visible MCB design defaults as normal
plan placement: C10/2P for lighting, C16/2P for sockets and equipment, with 1.5/2.5 mm²
cable defaults respectively. These values are editable defaults, never scan measurements.
Historical scans may retain unspecified `OTHER` carriers and remain readable. Cable
fields retain required editable defaults, with
`hideWireLabel: true` until review. Clearing `scanReview` does not change endpoint or
placement identities. Older readers preserve these optional fields.

Detected closed rooms produce ordinary editable situation-plan note labels, and accepted
names organize separate socket/lighting groups per room. Room detection uses virtual
intersection vertices without changing persisted wall vertices. Names are inferred
conservatively from RoomPlan sections and recognized furniture; conflicting or insufficient
evidence uses numbered rooms.

A plan placement may carry optional `mountingHeightM`, a finite nonnegative height in
metres above its own floor's finished level. Scan imports round measurements to whole
centimetres and store them here as well as in reference evidence. Cable estimates use
this per-placement value instead of the generic socket/switch/panel/device defaults;
missing values preserve the previous behavior. Heights belong to placements because one
device may have occurrences on different floors.

A floor imported from a TRiK page may carry optional `trikPlanReference` (`version: 1`): a list of
`anchors`, each a `key` (`figure:<image hash>` or `walls:<wall-shape hash>`) with the `center`,
`width`, `height` and `rotationDeg` at which that page drew it, in plan coordinates. When a later
TRiK file is added to the project, a page sharing an anchor key is recognised as the same floor and
its symbols are moved and scaled onto that floor's plan. Readers may ignore it; floors without it
fall back to matching by name.

CAD-derived floor plans use imported-plan asset kind `cad-vector` (distinct from PDF vector imports). When present, `cadReference` stores versioned source-coordinate metadata: source units, uncropped asset size, per-floor crop in both asset and model space, import-session linkage for multi-floor splits, and the forward/inverse transform parameters captured at import. Legacy projects imported before this metadata existed do not carry `cadReference`.

Floor-plan assets may carry two display flags: `darkModeAware` (adapt the plan when drawn in dark
mode) and, for vector plans, `grayscale` (draw the stored SVG in greyscale; `svgContent` keeps its
colours). Readers that ignore `grayscale` draw the plan in colour. Plans greyscaled at import by
older versions have greyscale `svgContent` itself and cannot be switched back to colour.

## Compatibility and normalization

The loader accepts:

- `2.4.0`, the native format for projects containing one-wire forks;
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
