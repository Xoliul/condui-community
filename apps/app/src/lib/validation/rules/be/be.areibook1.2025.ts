/**
 * Sample rule pack for Belgium AREI Book 1 (2025)
 * Contains 5-8 sample rules demonstrating the validation framework
 */
import type { RulePack } from '../../core/types'

export const beAreiBook1_2025: RulePack = {
  id: 'be.areibook1.2025',
  jurisdiction: 'BE',
  version: '2025',
  effectiveFrom: 1980, // Apply to all projects from 1980 onwards
  metadata: {
    name: 'AREI Book 1 (2025)',
    description: 'Algemeen Reglement op de Elektrische Installaties - Book 1',
    author: 'Condui',
    source: 'AREI',
  },
  rules: [
    {
      id: 'be.areibook1.2025.supply-mode-paths',
      title: 'Grid and backup supply paths',
      severity: 'error',
      appliesTo: ['subgraph'],
      checks: [{ name: 'supplyModePaths' }],
      message: 'validation.rules.be.areibook1.2025.supply-mode-paths.message',
      details: 'validation.rules.be.areibook1.2025.supply-mode-paths.details',
      remediation: 'validation.rules.be.areibook1.2025.supply-mode-paths.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 4.2.3.1, § 5.3.3.1',
        },
      ],
      tags: ['supply', 'backup', 'topology', 'phase'],
    },
    {
      id: 'be.areibook1.2025.supply-conductor-protection-coordination',
      title: 'Supply conductor and overcurrent protection coordination',
      severity: 'error',
      appliesTo: ['subgraph'],
      checks: [{ name: 'supplyConductorProtectionCoordination' }],
      message:
        'validation.rules.be.areibook1.2025.supply-conductor-protection-coordination.message',
      details:
        'validation.rules.be.areibook1.2025.supply-conductor-protection-coordination.details',
      remediation:
        'validation.rules.be.areibook1.2025.supply-conductor-protection-coordination.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 4.4.1.4, § 4.4.3.2',
          page: '121-122',
        },
      ],
      tags: ['supply', 'cable', 'overcurrent', 'protection'],
    },
    {
      id: 'be.areibook1.2025.backup-supply-rcd',
      title: 'RCD on backup supply path',
      severity: 'error',
      appliesTo: ['subgraph'],
      checks: [{ name: 'backupSupplyRcdCompliance' }],
      message: 'validation.rules.be.areibook1.2025.backup-supply-rcd.message',
      details: 'validation.rules.be.areibook1.2025.backup-supply-rcd.details',
      remediation: 'validation.rules.be.areibook1.2025.backup-supply-rcd.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.3(a)',
        },
      ],
      tags: ['rcd', 'supply', 'backup'],
    },
    {
      id: 'be.areibook1.2025.diagram-sitplan-consistency',
      title: 'Diagram/sitplan consistency - circuit point ID',
      severity: 'error',
      appliesTo: ['placement'],
      checks: [
        {
          name: 'placementHasValidIdentifier',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.diagram-sitplan-consistency.message',
      details: 'validation.rules.be.areibook1.2025.diagram-sitplan-consistency.details',
      remediation: 'validation.rules.be.areibook1.2025.diagram-sitplan-consistency.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 3.1, § 5.2',
        },
      ],
      tags: ['consistency', 'sitplan', 'diagram'],
    },
    {
      id: 'be.areibook1.2025.hidden-situation-plan-symbols',
      title: 'Hidden situation-plan symbols',
      severity: 'info',
      appliesTo: ['board'],
      checks: [{ name: 'hiddenSituationPlanSymbolsAreVisible' }],
      message: 'validation.rules.be.areibook1.2025.hidden-situation-plan-symbols.message',
      details: 'validation.rules.be.areibook1.2025.hidden-situation-plan-symbols.details',
      remediation: 'validation.rules.be.areibook1.2025.hidden-situation-plan-symbols.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 3.1.2.3',
        },
      ],
      tags: ['consistency', 'sitplan', 'visibility', 'documentation'],
    },
    {
      id: 'be.areibook1.2025.unplaced-situation-plan-symbols',
      title: 'Situation-plan symbols not placed yet',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [{ name: 'situationPlanSymbolsArePlaced' }],
      message: 'validation.rules.be.areibook1.2025.unplaced-situation-plan-symbols.message',
      details: 'validation.rules.be.areibook1.2025.unplaced-situation-plan-symbols.details',
      remediation: 'validation.rules.be.areibook1.2025.unplaced-situation-plan-symbols.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 3.1.2.3',
        },
      ],
      tags: ['consistency', 'sitplan', 'documentation'],
    },
    {
      id: 'be.areibook1.2025.sources-consistency',
      title: 'Sources consistency',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [
        {
          name: 'hasSupplyOrigin',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.sources-consistency.message',
      details: 'validation.rules.be.areibook1.2025.sources-consistency.details',
      remediation: 'validation.rules.be.areibook1.2025.sources-consistency.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 3.1',
        },
      ],
      tags: ['sources', 'consistency'],
    },
    {
      id: 'be.areibook1.2025.nonhousehold-board-grounded-network',
      title: 'Non-household board grounded network marking',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [{ name: 'nonHouseholdPanelShowsGroundedNetwork' }],
      message: 'validation.rules.be.areibook1.2025.nonhousehold-board-grounded-network.message',
      details: 'validation.rules.be.areibook1.2025.nonhousehold-board-grounded-network.details',
      remediation:
        'validation.rules.be.areibook1.2025.nonhousehold-board-grounded-network.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 3.1.3.3(b)',
          page: '69',
        },
      ],
      tags: ['non-household', 'board', 'grounded-network', 'marking'],
    },
    {
      id: 'be.areibook1.2025.nonhousehold-board-numbering',
      title: 'Non-household board numbering',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [{ name: 'nonHouseholdPanelNumberingIsShown' }],
      message: 'validation.rules.be.areibook1.2025.nonhousehold-board-numbering.message',
      details: 'validation.rules.be.areibook1.2025.nonhousehold-board-numbering.details',
      remediation: 'validation.rules.be.areibook1.2025.nonhousehold-board-numbering.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 3.1.3.3(b)',
          page: '69',
        },
      ],
      tags: ['non-household', 'board', 'numbering', 'marking'],
    },
    {
      id: 'be.areibook1.2025.nonhousehold-circuit-cable-length',
      title: 'Non-household circuit cable length shown',
      severity: 'warning',
      appliesTo: ['circuit'],
      checks: [{ name: 'nonHouseholdCircuitShowsCableLength' }],
      message: 'validation.rules.be.areibook1.2025.nonhousehold-circuit-cable-length.message',
      details: 'validation.rules.be.areibook1.2025.nonhousehold-circuit-cable-length.details',
      remediation:
        'validation.rules.be.areibook1.2025.nonhousehold-circuit-cable-length.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 3.1.2.2(b)',
          page: '67',
        },
      ],
      tags: ['non-household', 'circuit', 'cable-length', 'documentation'],
    },
    {
      id: 'be.areibook1.2025.household-breaking-capacity',
      title: 'Household breaking capacity',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [{ name: 'householdBoardBreakingCapacity' }],
      message: 'validation.rules.be.areibook1.2025.household-breaking-capacity.message',
      details: 'validation.rules.be.areibook1.2025.household-breaking-capacity.details',
      remediation: 'validation.rules.be.areibook1.2025.household-breaking-capacity.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.5(e)',
        },
      ],
      tags: ['household', 'protection', 'short-circuit'],
    },
    {
      id: 'be.areibook1.2025.household-supply-breaking-capacity',
      title: 'Household supply breaking capacity',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [{ name: 'householdSupplyBreakingCapacity' }],
      message: 'validation.rules.be.areibook1.2025.household-supply-breaking-capacity.message',
      details: 'validation.rules.be.areibook1.2025.household-supply-breaking-capacity.details',
      remediation:
        'validation.rules.be.areibook1.2025.household-supply-breaking-capacity.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.5(e)',
        },
      ],
      tags: ['household', 'supply', 'protection', 'short-circuit'],
    },
    {
      id: 'be.areibook1.2025.maximum-protected-length',
      title: 'Cable within maximum protected length',
      severity: 'warning',
      appliesTo: ['circuit'],
      checks: [{ name: 'circuitWithinMaximumProtectedLength' }],
      message: 'validation.rules.be.areibook1.2025.maximum-protected-length.message',
      details: 'validation.rules.be.areibook1.2025.maximum-protected-length.details',
      remediation: 'validation.rules.be.areibook1.2025.maximum-protected-length.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 4.4.2.1, § 5.3.5.5(h)',
        },
      ],
      tags: ['circuit', 'cable', 'cable-length', 'short-circuit'],
    },
    {
      id: 'be.areibook1.2025.main-rcd',
      title: 'Main RCD on supply trunk',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [
        {
          name: 'mainRcdCompliance',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.main-rcd.message',
      details: 'validation.rules.be.areibook1.2025.main-rcd.details',
      remediation: 'validation.rules.be.areibook1.2025.main-rcd.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.3(a)',
        },
      ],
      tags: ['rcd', 'supply', 'protection'],
    },
    {
      id: 'be.areibook1.2025.board-global-isolation',
      title: 'Board global isolation (all active conductors)',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [
        {
          name: 'panelHasGlobalIsolation',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.board-global-isolation.message',
      details: 'validation.rules.be.areibook1.2025.board-global-isolation.details',
      remediation: 'validation.rules.be.areibook1.2025.board-global-isolation.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.1',
        },
      ],
      tags: ['isolation', 'board', 'safety'],
    },
    {
      id: 'be.areibook1.2025.board-local-isolation-hint',
      title: 'Board local isolation recommendation',
      severity: 'info',
      appliesTo: ['board'],
      checks: [
        {
          name: 'panelHasLocalIsolationHint',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.board-local-isolation-hint.message',
      details: 'validation.rules.be.areibook1.2025.board-local-isolation-hint.details',
      remediation: 'validation.rules.be.areibook1.2025.board-local-isolation-hint.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.1',
        },
      ],
      tags: ['isolation', 'board', 'best-practice'],
    },
    {
      id: 'be.areibook1.2025.duplicate-panel-protection-label',
      title: 'Unique protection labels per panel',
      severity: 'error',
      appliesTo: ['board'],
      checks: [
        {
          name: 'checkDuplicatePanelProtectionLabels',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.duplicate-panel-protection-label.message',
      details: 'validation.rules.be.areibook1.2025.duplicate-panel-protection-label.details',
      remediation:
        'validation.rules.be.areibook1.2025.duplicate-panel-protection-label.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.2.4.1',
        },
      ],
      tags: ['naming', 'panel', 'consistency'],
    },
    {
      id: 'be.areibook1.2025.converter-backup-labels',
      title: 'Backup-supply labels',
      severity: 'error',
      appliesTo: ['board'],
      checks: [{ name: 'checkConverterBackupLabels' }],
      message: 'validation.rules.be.areibook1.2025.converter-backup-labels.message',
      details: 'validation.rules.be.areibook1.2025.converter-backup-labels.details',
      remediation: 'validation.rules.be.areibook1.2025.converter-backup-labels.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 3.1.2',
        },
      ],
      tags: ['naming', 'supply', 'backup'],
    },
    {
      id: 'be.areibook1.2025.phase-protection-compatibility',
      title: 'Protection and phase compatibility',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [{ name: 'protectionPhaseCompatibility' }],
      message: 'validation.rules.be.areibook1.2025.phase-protection-compatibility.message',
      details: 'validation.rules.be.areibook1.2025.phase-protection-compatibility.details',
      citations: [],
      tags: ['phase', 'protection', 'consistency'],
    },
    {
      id: 'be.areibook1.2025.overcurrent-upstream',
      title: 'Overcurrent device upstream',
      severity: 'warning',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'hasUpstreamOvercurrent',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.overcurrent-upstream.message',
      details: 'validation.rules.be.areibook1.2025.overcurrent-upstream.details',
      remediation: 'validation.rules.be.areibook1.2025.overcurrent-upstream.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.2.4.1',
        },
      ],
      tags: ['protection', 'overcurrent'],
    },
    {
      id: 'be.areibook1.2025.rcd-grouping',
      title: 'RCD grouping - max circuits',
      severity: 'warning',
      appliesTo: ['device'],
      checks: [
        {
          name: 'rcdHasTooManyCircuits',
          params: {
            threshold: 8,
          },
        },
      ],
      message: 'validation.rules.be.areibook1.2025.rcd-grouping.message',
      details: 'validation.rules.be.areibook1.2025.rcd-grouping.details',
      remediation: 'validation.rules.be.areibook1.2025.rcd-grouping.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.3(a)',
        },
      ],
      tags: ['rcd', 'grouping'],
    },
    {
      id: 'be.areibook1.2025.rcd-selectivity',
      title: 'RCD selectivity (upstream less sensitive than downstream)',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [
        {
          name: 'rcdSelectivity',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.rcd-selectivity.message',
      details: 'validation.rules.be.areibook1.2025.rcd-selectivity.details',
      remediation: 'validation.rules.be.areibook1.2025.rcd-selectivity.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.3(a)',
        },
      ],
      tags: ['rcd', 'selectivity'],
    },
    {
      id: 'be.areibook1.2025.bathroom-rcd-30ma',
      title: 'Bathroom/wet room circuits require 30 mA RCD protection',
      severity: 'warning',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'wetRoomRequires30mAFromCircuitNotes',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.bathroom-rcd-30ma.message',
      details: 'validation.rules.be.areibook1.2025.bathroom-rcd-30ma.details',
      remediation: 'validation.rules.be.areibook1.2025.bathroom-rcd-30ma.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 7.1.4.3',
          page: '230',
        },
      ],
      tags: ['rcd', 'bathroom', 'wet-room', 'protection'],
    },
    {
      id: 'be.areibook1.2025.minimum-lighting-circuits',
      title: 'Minimum lighting circuits',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [
        {
          name: 'installationHasMinimumLightingCircuits',
          params: {
            threshold: 2,
          },
        },
      ],
      message: 'validation.rules.be.areibook1.2025.minimum-lighting-circuits.message',
      details: 'validation.rules.be.areibook1.2025.minimum-lighting-circuits.details',
      remediation: 'validation.rules.be.areibook1.2025.minimum-lighting-circuits.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.2(b)',
        },
      ],
      tags: ['circuit', 'lighting'],
    },
    {
      id: 'be.areibook1.2025.installation-earthing',
      title: 'Installation earthing present',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [{ name: 'installationHasEarthing' }],
      message: 'validation.rules.be.areibook1.2025.installation-earthing.message',
      details: 'validation.rules.be.areibook1.2025.installation-earthing.details',
      remediation: 'validation.rules.be.areibook1.2025.installation-earthing.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.4.2.1',
        },
      ],
      tags: ['earthing', 'ground', 'consistency'],
    },
    {
      id: 'be.areibook1.2025.multiple-earthing-locations',
      title: 'Single earthing location',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [{ name: 'installationHasSingleEarthingLocation' }],
      message: 'validation.rules.be.areibook1.2025.multiple-earthing-locations.message',
      details: 'validation.rules.be.areibook1.2025.multiple-earthing-locations.details',
      remediation: 'validation.rules.be.areibook1.2025.multiple-earthing-locations.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.4.2.1',
        },
      ],
      tags: ['earthing', 'ground', 'consistency'],
    },
    {
      id: 'be.areibook1.2025.max-endpoints-per-circuit',
      title: 'Max endpoints per circuit',
      severity: 'error',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'circuitHasTooManyEndpoints',
          params: {
            threshold: 8,
          },
        },
      ],
      message: 'validation.rules.be.areibook1.2025.max-endpoints-per-circuit.message',
      details: 'validation.rules.be.areibook1.2025.max-endpoints-per-circuit.details',
      remediation: 'validation.rules.be.areibook1.2025.max-endpoints-per-circuit.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.5.2',
        },
      ],
      tags: ['circuit', 'endpoints'],
    },
    {
      id: 'be.areibook1.2025.cable-cross-section',
      title: 'Cable cross-section presence',
      severity: 'error',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'cableHasCrossSection',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.cable-cross-section.message',
      details: 'validation.rules.be.areibook1.2025.cable-cross-section.details',
      remediation: 'validation.rules.be.areibook1.2025.cable-cross-section.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.2.1.2',
        },
      ],
      tags: ['cable', 'cross-section'],
    },
    {
      id: 'be.areibook1.2025.breaker-vs-cross-section',
      title: 'Breaker rating vs cable size',
      severity: 'error',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'breakerSizeMatchesCrossSection',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.breaker-vs-cross-section.message',
      details: 'validation.rules.be.areibook1.2025.breaker-vs-cross-section.details',
      remediation: 'validation.rules.be.areibook1.2025.breaker-vs-cross-section.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 4.4.1.5, § 5.2.4.1',
        },
      ],
      tags: ['protection', 'cable', 'overcurrent'],
    },
    {
      id: 'be.areibook1.2025.rcd-required-by-circuit-type',
      title: 'RCD 30 mA required for designated household and EV circuits',
      severity: 'warning',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'circuitHasRcdProtection',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.rcd-required-by-circuit-type.message',
      details: 'validation.rules.be.areibook1.2025.rcd-required-by-circuit-type.details',
      remediation: 'validation.rules.be.areibook1.2025.rcd-required-by-circuit-type.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 4.2.4.3(b), § 5.3.5.3(f), § 7.22.4.1',
        },
      ],
      tags: ['rcd', 'circuits', 'protection', 'ev', 'dc-residual-current'],
    },
    // Rule 5 (neutral isolation) not implemented: single-wire model does not model neutral bus separation per RCD group.
    {
      id: 'be.areibook1.2025.minimum-cross-section',
      title: 'Minimum cable cross-section per circuit type',
      severity: 'error',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'minimumCrossSection',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.minimum-cross-section.message',
      details: 'validation.rules.be.areibook1.2025.minimum-cross-section.details',
      remediation: 'validation.rules.be.areibook1.2025.minimum-cross-section.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.2.1.2',
        },
      ],
      tags: ['cable', 'cross-section'],
    },
    {
      id: 'be.areibook1.2025.heavy-appliance-dedicated-circuit',
      title: 'Heavy fixed appliances on dedicated leaf circuit',
      severity: 'warning',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'heavyApplianceRequiresDedicatedCircuit',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.heavy-appliance-dedicated-circuit.message',
      details: 'validation.rules.be.areibook1.2025.heavy-appliance-dedicated-circuit.details',
      remediation:
        'validation.rules.be.areibook1.2025.heavy-appliance-dedicated-circuit.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.2.1.2',
        },
      ],
      tags: ['circuit', 'fixed_appliance'],
    },
    {
      id: 'be.areibook1.2025.fixed-appliance-dedicated-hint',
      title: 'Fixed appliance dedicated circuit hint',
      severity: 'info',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'fixedApplianceDedicatedCircuitHint',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.fixed-appliance-dedicated-hint.message',
      details: 'validation.rules.be.areibook1.2025.fixed-appliance-dedicated-hint.details',
      remediation: 'validation.rules.be.areibook1.2025.fixed-appliance-dedicated-hint.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.4.1',
        },
      ],
      tags: ['circuit', 'fixed_appliance'],
    },
    {
      id: 'be.areibook1.2025.stove-sizing-hint',
      title: 'Cooker circuit sizing recommendation',
      severity: 'info',
      appliesTo: ['circuit'],
      checks: [
        {
          name: 'stoveCircuitSizingHint',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.stove-sizing-hint.message',
      details: 'validation.rules.be.areibook1.2025.stove-sizing-hint.details',
      remediation: 'validation.rules.be.areibook1.2025.stove-sizing-hint.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.4.4',
        },
      ],
      tags: ['circuit', 'stove'],
    },
    {
      id: 'be.areibook1.2025.cascade-protection',
      title: 'Cascading breaker ratings',
      severity: 'warning',
      appliesTo: ['board', 'circuit'],
      checks: [
        {
          name: 'cascadeProtectionRatings',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.cascade-protection.message',
      details: 'validation.rules.be.areibook1.2025.cascade-protection.details',
      remediation: 'validation.rules.be.areibook1.2025.cascade-protection.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 4.4.1.5, § 5.2.4.1',
        },
      ],
      tags: ['protection', 'overcurrent'],
    },
    {
      id: 'be.areibook1.2025.switch-load-reference',
      title: 'Switch-load reference',
      severity: 'info',
      appliesTo: ['device'],
      checks: [
        {
          name: 'switchHasControlledLoads',
        },
      ],
      message: 'validation.rules.be.areibook1.2025.switch-load-reference.message',
      details: 'validation.rules.be.areibook1.2025.switch-load-reference.details',
      remediation: 'validation.rules.be.areibook1.2025.switch-load-reference.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.4.2',
        },
      ],
      tags: ['switch', 'control'],
    },
    {
      id: 'be.areibook1.2025.electrical-domain',
      title: 'Electrical domain consistency (AC/DC)',
      severity: 'warning',
      appliesTo: ['board'],
      checks: [
        {
          name: 'electricalDomainConsistency',
          params: { ruleId: 'be.areibook1.2025.electrical-domain' },
        },
      ],
      message: 'validation.rules.be.areibook1.2025.electrical-domain.message',
      details: 'validation.rules.be.areibook1.2025.electrical-domain.details',
      remediation: 'validation.rules.be.areibook1.2025.electrical-domain.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.2.2.1',
        },
      ],
      tags: ['domain', 'AC', 'DC', 'conversion'],
    },
    {
      id: 'be.areibook1.2025.post-main-bus-pe-conductor',
      title: 'Protective earth conductor after main bus (AC)',
      severity: 'info',
      appliesTo: ['board'],
      checks: [
        {
          name: 'postMainBusRequiresPeConductor',
          params: { ruleId: 'be.areibook1.2025.post-main-bus-pe-conductor' },
        },
      ],
      message: 'validation.rules.be.areibook1.2025.post-main-bus-pe-conductor.message',
      details: 'validation.rules.be.areibook1.2025.post-main-bus-pe-conductor.details',
      remediation: 'validation.rules.be.areibook1.2025.post-main-bus-pe-conductor.remediation',
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.3.2',
        },
      ],
      tags: ['cable', 'PE', 'earthing', 'supply'],
    },
  ],
}
