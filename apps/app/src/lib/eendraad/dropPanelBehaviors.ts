import { resolveSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'
import { generateId } from '@/utils'
import { getNextAvailableCircuitCode, countPanels } from '@/utils/project'
import { getVoltagePolesConfig, getDefaultProtectionProps } from '@/lib/protectionDefaults'
import { getPortDomainsForSymbol } from '@/lib/symbols'
import { createDefaultAcCircuitCable, DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS } from '@/lib/wires/circuitWireDefaults'
import {
  domoticaChildRefForEndpoint,
  updateDomoticaChainHeadAfterInsert,
  domoticaChildRefForBranchInsert,
  insertDomoticaChildEndpoint,
} from '@/lib/eendraad/domoticaOutputOrdering'
import type {
  Endpoint,
  ProtectionDevice,
  Circuit,
  Panel,
} from '@/types/schema'
import { computeEndpointInsertAfter } from '@/lib/eendraad/endpointInsertAfter'
import { DEFAULT_SECONDARY_PANEL_GRID_COLUMNS, DEFAULT_SECONDARY_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { clamp } from '@/lib/geometry'
import { DOMOTICA_MAX_ENDPOINT_OUTPUTS } from '@/lib/domoticaLayout'
import { findAssemblyForDirectConverter, retargetDirectConverterBackupPanel } from '@/lib/supplyAssembly/editorIntegration'
import {
  type DropBehavior,
  viewportCenterOn,
  projectPanels,
  projectInstallation,
  findPanelForTarget,
  findProtectionByCircuitIdInProject,
} from './dropBehaviorModel'
import { getWireDomainAtDropTarget } from './dropWireDomain'
import { addGroundTrunkDevice } from './dropSupplyDevices'

/**
 * Panel drop behavior
 */
export const panelBehavior: DropBehavior = {
  validTargets: [null, 'mainBus', 'circuit', 'endpoint', 'protection', 'rcd'],
  execute: (target, project, _symbol, t, callbacks) => {
    const panels = projectPanels(project)
    const totalPanelCount = countPanels(panels)
    const secondaryPanelName = (number: number) =>
      t('panels.secondaryPanel', { number, defaultValue: `Panel ${number}` })
    // After a deletion the count can point at a name still in use; boards are found by name.
    const takenNames = new Set<string>()
    const collectNames = (list: Panel[]) => list.forEach((panel) => { takenNames.add(panel.name); collectNames(panel.subPanels ?? []) })
    collectNames(panels)
    let panelNumber = totalPanelCount + 1
    while (takenNames.has(secondaryPanelName(panelNumber))) panelNumber += 1

    const createPanel = (isMain: boolean): Panel => ({
      id: callbacks.newId?.() ?? generateId(),
      name:
        totalPanelCount === 0
          ? t('panels.mainPanel', { defaultValue: 'Main Panel' })
          : secondaryPanelName(panelNumber),
      symbol: 'panel_distribution',
      isMain,
      protections: [],
      circuits: [],
      subPanels: [],
      ...(!isMain
        ? {
            gridView: {
              rows: DEFAULT_SECONDARY_PANEL_GRID_ROWS,
              columns: DEFAULT_SECONDARY_PANEL_GRID_COLUMNS,
              feedFromTop: false,
              slots: [],
            },
          }
        : {}),
    })

    // If no panels exist, create the first main panel.
    if (panels.length === 0) {
      const newMainPanel = createPanel(true)

      // addPanel already calls ensurePanelPlacement internally and creates
      // a PANEL circuit with the endpoint — no need to duplicate that here.
      callbacks.addPanel(newMainPanel)

      callbacks.setSelection({ type: 'panel', ids: [newMainPanel.id] })
      return
    }

    // A drop outside any panel frame / wire becomes a new root/main panel.
    if (target.type === null && !target.panelId) {
      const newRootPanel = createPanel(true)
      callbacks.addPanel(newRootPanel)
      callbacks.setSelection({ type: 'panel', ids: [newRootPanel.id] })
      return
    }

    // An empty area inside an existing panel frame is still an explicit place
    // to add another parallel/main panel.  Do not silently turn this into a
    // nested secondary panel (or discard the drop); nesting remains reserved
    // for the main-bus/circuit targets below.
    if (target.type === null && target.panelId) {
      const newRootPanel = createPanel(true)
      callbacks.addPanel(newRootPanel)
      callbacks.setSelection({ type: 'panel', ids: [newRootPanel.id] })
      return
    }

    // Determine which panel to nest the new secondary board under, then add feeder MCB/circuit.
    // Use the target panel if available, otherwise fall back to main panel
    let parentPanel: Panel | null = null
    if (target.panelId) {
      parentPanel = findPanelForTarget(project, target)
    }
    if (!parentPanel) {
      parentPanel = panels.find((p) => p.isMain) ?? panels[0] ?? null
    }
    if (!parentPanel) return

    const newPanel = createPanel(false)
    const newPanelId = newPanel.id
    const outputCircuit = target.circuitId ? callbacks.getCircuitById(target.circuitId) : null
    const outputRef = target.domoticaOutput && target.endpointId
      ? {
          parentEndpointId: target.endpointId,
          outputGroup: 'endpoint' as const,
          outputIndex: target.domoticaOutput.index,
        }
      : outputCircuit
        ? domoticaChildRefForEndpoint(outputCircuit, target.endpointId) ??
          domoticaChildRefForBranchInsert(outputCircuit, target.insertAfterEndpointId, target.branchEndpoints)
        : undefined
    if (outputRef && outputCircuit) {
      const module = outputCircuit.endpoints.find((endpoint) => endpoint.id === outputRef.parentEndpointId)
      if (!module || module.symbol !== 'domotica' || !findProtectionByCircuitIdInProject(panels, outputCircuit.id) ||
        (target.domoticaOutput && target.domoticaOutput.group !== 'endpoint') ||
        outputRef.outputIndex < 0 || outputRef.outputIndex >= DOMOTICA_MAX_ENDPOINT_OUTPUTS ||
        outputRef.outputIndex >= (module.domoticaProps?.endpointCount ?? 1) + (target.domoticaOutput?.expands ? 1 : 0)) return
      const wireDomain = getWireDomainAtDropTarget(target, project, callbacks)
      if (wireDomain !== 'AC') {
        const ports = getPortDomainsForSymbol(_symbol.id)
        callbacks.onDropRejected?.(t('wires.domainMismatchDrop', {
          component: _symbol.name, wireDomain, domain: 'AC', portA: ports[0], portB: ports[1],
        }))
        return
      }

      // This board consumes one switched output, alongside any existing loads.
      // subPanelId would incorrectly turn the entire module circuit into a feeder.
      callbacks.addPanel(newPanel, parentPanel.id)
      const endpoint: Endpoint = {
        id: callbacks.newId?.() ?? generateId(),
        type: 'fixed_appliance',
        symbol: 'panel_distribution',
        panelId: newPanelId,
        label: newPanel.name,
        placements: [],
        domoticaChildProps: outputRef,
      }
      const insertion = computeEndpointInsertAfter(target, outputCircuit, _symbol)
      const existingRow = outputCircuit.endpoints.filter((candidate) =>
        candidate.domoticaChildProps?.parentEndpointId === outputRef.parentEndpointId &&
        candidate.domoticaChildProps.outputGroup === outputRef.outputGroup &&
        candidate.domoticaChildProps.outputIndex === outputRef.outputIndex)
      callbacks.addEndpoint(outputCircuit.id, endpoint,
        target.domoticaOutput && existingRow.length ? existingRow.at(-1)!.id : insertion.insertAfterEndpointId)
      const afterAdd = callbacks.getCircuitById(outputCircuit.id)
      if (afterAdd && target.domoticaOutput && existingRow.length === 0) {
        const inserted = insertDomoticaChildEndpoint(
          afterAdd, endpoint.id, outputRef.parentEndpointId, 'endpoint', outputRef.outputIndex
        )
        if (inserted) callbacks.updateCircuit(outputCircuit.id, {
          endpoints: inserted.endpoints,
          branches: inserted.branches,
        })
      } else if (afterAdd && target.domoticaChildDropIntent === 'insertBefore') {
        callbacks.updateCircuit(outputCircuit.id, {
          endpoints: updateDomoticaChainHeadAfterInsert(afterAdd, endpoint.id, target.endpointId),
        })
      }
      callbacks.setSelection({ type: 'panel', ids: [newPanelId] })
      return
    }
    if (outputCircuit?.endpoints.some((endpoint) =>
      endpoint.id === target.endpointId && endpoint.symbol === 'domotica')) return
    const converterBackupCircuit = target.circuitId
      ? callbacks.getCircuitById(target.circuitId)
      : null
    const isConverterBackupPanel = converterBackupCircuit?.supplySource?.kind === 'converter-backup'

    if (isConverterBackupPanel && converterBackupCircuit?.supplySource) {
      const feederProtection = findProtectionByCircuitIdInProject(panels, converterBackupCircuit.id)
      if (!feederProtection) return

      // This is an existing horizontal backup circuit. Turn its own protection into
      // the panel feeder; never create a second protection on the main bus.
      callbacks.addPanel(newPanel)
      callbacks.updateProtection(feederProtection.id, { subPanelId: newPanelId })

      const panelEndpointId = callbacks.newId?.() ?? generateId()
      callbacks.addEndpoint(converterBackupCircuit.id, {
        id: panelEndpointId,
        type: 'fixed_appliance',
        label: newPanel.name,
        symbol: 'panel_distribution',
        panelId: newPanelId,
        placements: [],
      })
      const circuitWithPanel = callbacks.getCircuitById(converterBackupCircuit.id)
      if (circuitWithPanel) {
        const branch = circuitWithPanel.branches?.[0] ?? {
          id: callbacks.newId?.() ?? generateId(),
          label: '',
          endpointIds: [],
        }
        callbacks.updateCircuit(converterBackupCircuit.id, {
          branches: [
            {
              ...branch,
              endpointIds: circuitWithPanel.endpoints.map((endpoint) => endpoint.id),
            },
          ],
        })
      }

      const assembly = findAssemblyForDirectConverter(
        project,
        converterBackupCircuit.supplySource.converterId
      )
      if (assembly) {
        callbacks.replaceSupplyAssembly(
          assembly.id,
          retargetDirectConverterBackupPanel(assembly, converterBackupCircuit.id, newPanelId)
        )
      }

      callbacks.setSelection({ type: 'panel', ids: [newPanelId] })
      return
    }

    // Ordinary secondary boards remain structurally nested under their source panel.
    callbacks.addPanel(newPanel, parentPanel.id)

    // Prefer reusing an explicitly targeted empty feeder (protection/circuit)
    // so dropping onto an empty slot does not create an extra feeder circuit.
    let feederProtection: ProtectionDevice | null = null
    if (target.type === 'protection' && target.protectionId) {
      feederProtection = callbacks.getProtectionById(target.protectionId)
    } else if ((target.type === 'circuit' || target.type === 'endpoint') && target.circuitId) {
      feederProtection = findProtectionByCircuitIdInProject(panels, target.circuitId)
    }
    const feederCircuit = feederProtection?.circuits?.[0]
    const canAttachToTargetFeeder =
      !!feederProtection &&
      !!feederCircuit &&
      !feederProtection.subPanelId &&
      typeof target.secondaryBusInsertIndex !== 'number' &&
      target.type !== 'rcd'

    if (canAttachToTargetFeeder && feederProtection) {
      callbacks.updateProtection(feederProtection.id, { subPanelId: newPanelId })
    } else {
      // Create MCB protection on the parent panel that feeds this sub-panel.
      // The MCB's subPanelId links it so the layout engine can render the
      // parent MCB on the sub-panel's supply wire as a mirrored reference.
      const protectionId = callbacks.newId?.() ?? generateId()
      const circuitId = callbacks.newId?.() ?? generateId()
      const voltagePoles = getVoltagePolesConfig(project)
      const mcbDefaults = getDefaultProtectionProps('MCB', voltagePoles)
      const feederCode = getNextAvailableCircuitCode(project, parentPanel.id)
      const mcbProtection: ProtectionDevice = {
        id: protectionId,
        type: 'MCB',
        label: feederCode,
        circuits: [],
        subPanelId: newPanelId,
        ...mcbDefaults,
      }

      callbacks.addProtection(parentPanel.id, mcbProtection)

      const mcbCircuit: Circuit = {
        id: circuitId,
        code: feederCode,
        kind: 'other',
        cable: createDefaultAcCircuitCable({ sectionMm2: 6 }),
        endpoints: [],
        ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
      }

      callbacks.addCircuit(parentPanel.id, mcbCircuit, protectionId)

      if (target.type === 'rcd' && target.protectionId) {
        callbacks.addCircuitToProtection(parentPanel.id, target.protectionId, mcbCircuit)
        if (typeof target.secondaryBusInsertIndex === 'number') {
          const targetRcd = callbacks.getProtectionById(target.protectionId)
          if (targetRcd?.circuits) {
            const ordered = targetRcd.circuits.filter((circuit) => circuit.id !== mcbCircuit.id)
            ordered.splice(clamp(target.secondaryBusInsertIndex, 0, ordered.length), 0, mcbCircuit)
            callbacks.updateProtection(targetRcd.id, { circuits: ordered })
          }
        }
      } else if (
        target.type === 'circuit' &&
        target.circuitId &&
        typeof target.secondaryBusInsertIndex === 'number'
      ) {
        callbacks.moveCircuitToSecondaryBus(
          parentPanel.id,
          target.circuitId,
          mcbCircuit.id,
          target.secondaryBusInsertIndex
        )
      } else if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
        const beforeCount = target.mainBusItemCount ?? 0
        const desiredIndex = clamp(target.mainBusInsertIndex, 0, beforeCount)
        for (let index = beforeCount; index > desiredIndex; index -= 1) {
          callbacks.moveCircuitOnMainBus(parentPanel.id, mcbCircuit.id, 'left')
        }
      }
    }

    callbacks.setSelection({ type: 'panel', ids: [newPanelId] })
  },
}

/**
 * Ground drop behavior
 */
export const groundBehavior: DropBehavior = {
  validTargets: ['mainBus'],
  execute: (target, project, _symbol, _t, callbacks) => {
    const panel = findPanelForTarget(project, target)
    if (!panel) return

    if (panel.isMain === false) {
      const ensureStem = callbacks.ensureSecondaryPanelEarthingStem
      ensureStem(panel.id)
    } else if (projectInstallation(project)) {
      callbacks.updateInstallation({ hasGround: true })
    } else {
      return
    }

    const activeFloorId = resolveSitplanTargetFloorId(
      project,
      callbacks.getSitplanTarget().activeFloorId
    )
    if (activeFloorId) {
      const preferredPlanPos =
        viewportCenterOn(callbacks.getSitplanTarget(), activeFloorId) ?? undefined
      callbacks.ensureEarthingSitplanPlacement(activeFloorId, preferredPlanPos)
    }
  },
}

/**
 * Earthing separator drop behavior
 */
export const earthingSeparatorBehavior: DropBehavior = {
  validTargets: ['groundWire', 'mainBus'],
  execute: (target, project, symbol, t, callbacks) => {
    const panel = findPanelForTarget(project, target)
    if (!panel) return

    if (panel.isMain === false && target.type === 'mainBus') {
      const ensureStem = callbacks.ensureSecondaryPanelEarthingStem
      ensureStem(panel.id)
      const activeFloorId = resolveSitplanTargetFloorId(
        project,
        callbacks.getSitplanTarget().activeFloorId
      )
      if (activeFloorId) {
        const preferredPlanPos =
          viewportCenterOn(callbacks.getSitplanTarget(), activeFloorId) ?? undefined
        callbacks.ensureEarthingSitplanPlacement(activeFloorId, preferredPlanPos)
      }
      return
    }

    if (target.type === 'groundWire') {
      addGroundTrunkDevice(symbol, target, project, t, callbacks)
    }
  },
}
