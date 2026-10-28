package com.duapharma.mailroutine

import android.content.Context
import com.duapharma.mailroutine.ai.AnthropicDrafter
import com.duapharma.mailroutine.data.AppDatabase
import com.duapharma.mailroutine.data.RoomDeliveryStore
import com.duapharma.mailroutine.data.RoomRoutineRepository
import com.duapharma.mailroutine.data.RoutineRepository
import com.duapharma.mailroutine.gmail.GmailHttpSender
import com.duapharma.mailroutine.gmail.UrlConnectionTransport
import com.duapharma.mailroutine.platform.*
import com.duapharma.mailroutine.send.Clock
import com.duapharma.mailroutine.send.SendCoordinator
import com.duapharma.mailroutine.send.Sweeper
import java.time.Instant

/** Manual dependency graph; every collaborator is behind an interface so tests can substitute fakes. */
class AppContainer(context: Context) {
    val appContext: Context = context.applicationContext
    private val app get() = appContext
    val clock = Clock { Instant.now() }
    val db = AppDatabase.build(app)
    val store = RoomDeliveryStore(db)
    val repository: RoutineRepository = RoomRoutineRepository(db, store, clock)
    val attachments = AttachmentStore(app)
    val auth = GoogleAuthProvider(app)
    val gmail = GmailHttpSender()
    val coordinator = SendCoordinator(store, auth, gmail, attachments, clock)
    val notifier = AndroidNotifier(app)
    val scheduler = WorkSendScheduler(app)
    val alarms = AlarmScheduler(app, store, clock)
    val sweeper = Sweeper(store, coordinator, scheduler, notifier, clock)
    val aiSettings = AiSettings(app)
    val drafter = AnthropicDrafter(UrlConnectionTransport(), { aiSettings.apiKey }, { aiSettings.model })
}
