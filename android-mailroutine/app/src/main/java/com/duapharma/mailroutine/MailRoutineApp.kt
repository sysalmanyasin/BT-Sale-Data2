package com.duapharma.mailroutine

import android.app.Application
import com.duapharma.mailroutine.platform.WidgetRefresher

class MailRoutineApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.scheduler.ensurePeriodic()
        container.widgets.keepFresh(WidgetRefresher.appScope())
        container.scheduler.sweepNow() // recovers anything that came due while the app wasn't running
    }
}
