package expo.modules.memprobe

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// Process memory for SP-08: RSS and its kernel-tracked peak (VmHWM) from /proc/self/status, PSS from Debug,
// and the device's total RAM. resetPeak() writes 5 to /proc/self/clear_refs, which resets VmHWM.
class MemProbeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MemProbe")

    Function("snapshot") {
      val status = File("/proc/self/status").readLines()
      fun mb(key: String): Double =
        status.firstOrNull { it.startsWith("$key:") }
          ?.trim()?.split(Regex("\\s+"))?.getOrNull(1)?.toDoubleOrNull()?.div(1024.0) ?: -1.0
      val pss = Debug.MemoryInfo().also { Debug.getMemoryInfo(it) }.totalPss / 1024.0
      val am = appContext.reactContext?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val sys = ActivityManager.MemoryInfo().also { am?.getMemoryInfo(it) }
      mapOf(
        "rssMb" to mb("VmRSS"),
        "peakRssMb" to mb("VmHWM"),
        "pssMb" to pss,
        "nativeHeapMb" to Debug.getNativeHeapAllocatedSize() / 1048576.0,
        "deviceTotalMb" to sys.totalMem / 1048576.0,
      )
    }

    Function("resetPeak") {
      try {
        File("/proc/self/clear_refs").writeText("5")
        true
      } catch (e: Exception) {
        false
      }
    }
  }
}
