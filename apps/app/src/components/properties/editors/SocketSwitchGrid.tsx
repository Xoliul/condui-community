import { useTranslation } from 'react-i18next'
import { SOCKET_OVERLAY_PATHS } from '@/lib/symbols'
import type { SocketDeviceProps, SymbolKey } from '@/types/schema'
import { OptionToggleGrid } from './OptionToggleGrid'

type SocketSwitchOption = 'none' | 'switch' | 'switch_lock'

function socketSwitchValue(props: SocketDeviceProps | undefined): SocketSwitchOption {
  if (props?.switchOverlayLock) return 'switch_lock'
  if (props?.switchOverlay) return 'switch'
  return 'none'
}

export type SocketSwitchGridProps = {
  socketSymbol: SymbolKey
  socketProps: SocketDeviceProps | undefined
  onChange: (socketProps: SocketDeviceProps) => void
}

/** Integrated switch on a socket, drawn on the socket's own symbol like the socket type choice. */
export function SocketSwitchGrid({ socketSymbol, socketProps, onChange }: SocketSwitchGridProps) {
  const { t } = useTranslation()
  const socketIcon = `/symbols/outlets/${socketSymbol}.svg`

  return (
    <OptionToggleGrid<SocketSwitchOption>
      label={t('endpoints.socketSwitchOption', 'Switch')}
      value={socketSwitchValue(socketProps)}
      onChange={(value) =>
        onChange({
          ...socketProps,
          switchOverlay: value === 'switch',
          switchOverlayLock: value === 'switch_lock',
        })
      }
      options={[
        {
          value: 'none',
          label: t('endpoints.socketSwitchNone', 'None'),
          icon: socketIcon,
        },
        {
          value: 'switch',
          label: t('endpoints.socketSwitchOverlay', 'Socket with two-pole switch'),
          shortLabel: t('endpoints.socketSwitchOverlay_short', 'Switch'),
          icon: SOCKET_OVERLAY_PATHS.switchOverlay,
          baseIcon: socketIcon,
        },
        {
          value: 'switch_lock',
          label: t('endpoints.socketSwitchOverlayLock', 'Socket with two-pole lockable switch'),
          shortLabel: t('endpoints.socketSwitchOverlayLock_short', 'Lockable'),
          icon: SOCKET_OVERLAY_PATHS.switchOverlayLock,
          baseIcon: socketIcon,
        },
      ]}
    />
  )
}
