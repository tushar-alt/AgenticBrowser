import { ElectronAPI } from '../main/preload/index'

declare global {
  interface Window {
    api: ElectronAPI
  }
}
