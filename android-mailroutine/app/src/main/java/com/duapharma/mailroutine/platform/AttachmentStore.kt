package com.duapharma.mailroutine.platform

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.duapharma.mailroutine.domain.AttachmentRef
import com.duapharma.mailroutine.domain.AttachmentRules
import com.duapharma.mailroutine.domain.Limits
import com.duapharma.mailroutine.send.AttachmentSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

sealed interface AttachmentImport {
    data class Ok(val ref: AttachmentRef) : AttachmentImport
    data class Rejected(val reason: String) : AttachmentImport
}

/**
 * Copies picked files into app-private storage (no other app can read them) and serves them back by
 * opaque id. Paths and contents are never logged. Ids are validated so a tampered database or
 * backup cannot make the app read files outside its attachment directory.
 */
class AttachmentStore(private val context: Context) : AttachmentSource {
    private val dir = File(context.filesDir, "attachments").apply { mkdirs() }
    private val safeId = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    private fun fileFor(id: String): File? = if (safeId.matches(id)) File(dir, id) else null

    suspend fun import(uri: Uri, required: Boolean): AttachmentImport = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        var name = "attachment"; var declared = -1L
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getString(0)?.let { name = it }
                    if (!c.isNull(1)) declared = c.getLong(1)
                }
            }
        } catch (e: Exception) { return@withContext AttachmentImport.Rejected("Could not read the selected file") }
        if (AttachmentRules.isBlockedName(name)) return@withContext AttachmentImport.Rejected("This file type is blocked by Gmail")
        if (declared > Limits.MAX_ATTACHMENT_BYTES) return@withContext AttachmentImport.Rejected("File is larger than ${Limits.MAX_ATTACHMENT_BYTES / 1024 / 1024} MB")

        val id = UUID.randomUUID().toString()
        val target = fileFor(id)!!
        val tmp = File(dir, "$id.tmp")
        try {
            var total = 0L
            resolver.openInputStream(uri)?.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > Limits.MAX_ATTACHMENT_BYTES) { tmp.delete(); return@withContext AttachmentImport.Rejected("File is larger than ${Limits.MAX_ATTACHMENT_BYTES / 1024 / 1024} MB") }
                        out.write(buf, 0, n)
                    }
                }
            } ?: return@withContext AttachmentImport.Rejected("Could not open the selected file")
            AttachmentRules.validatePick(name, total)?.let { tmp.delete(); return@withContext AttachmentImport.Rejected(it) }
            if (!tmp.renameTo(target)) { tmp.delete(); return@withContext AttachmentImport.Rejected("Could not store the file") }
            AttachmentImport.Ok(AttachmentRef(id, name.take(120), total, resolver.getType(uri) ?: "application/octet-stream", required))
        } catch (e: Exception) {
            tmp.delete(); target.delete()
            AttachmentImport.Rejected("Could not copy the selected file")
        }
    }

    fun delete(id: String) { fileFor(id)?.delete() }

    override fun isAvailable(ref: AttachmentRef): Boolean {
        val f = fileFor(ref.id) ?: return false
        return f.isFile && f.length() > 0 && f.length() == ref.sizeBytes
    }

    override fun read(ref: AttachmentRef): ByteArray? =
        if (isAvailable(ref)) runCatching { fileFor(ref.id)!!.readBytes() }.getOrNull() else null
}
