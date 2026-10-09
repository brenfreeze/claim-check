import Darwin
import ExpoModulesCore

// Process memory for SP-08 on iOS: phys_footprint (what Xcode's memory gauge shows) and its peak.
// Untested in Phase 0: no Xcode or paid Apple account on the spike machine.
public class MemProbeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MemProbe")

    Function("snapshot") { () -> [String: Double] in
      let mb = 1048576.0
      let total = Double(ProcessInfo.processInfo.physicalMemory) / mb
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
      let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      guard kr == KERN_SUCCESS else {
        return ["rssMb": -1, "peakRssMb": -1, "pssMb": -1, "nativeHeapMb": -1, "deviceTotalMb": total]
      }
      return [
        "rssMb": Double(info.phys_footprint) / mb,
        "peakRssMb": Double(info.ledger_phys_footprint_peak) / mb,
        "pssMb": Double(info.resident_size) / mb,
        "nativeHeapMb": -1,
        "deviceTotalMb": total,
      ]
    }

    Function("resetPeak") { () -> Bool in
      false
    }
  }
}
