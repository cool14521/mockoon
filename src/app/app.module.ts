import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { AngularFireModule } from '@angular/fire';
import { AngularFireAuthModule } from '@angular/fire/auth';
import { AngularFirestoreModule, FirestoreSettingsToken } from '@angular/fire/firestore';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { AceEditorModule } from 'ng2-ace-editor';
import { DragulaModule } from 'ng2-dragula';
import { MarkdownModule, MarkedOptions } from 'ngx-markdown';
import { BannerComponent } from 'src/app/components/banner.component';
import { ChangelogModalComponent } from 'src/app/components/changelog-modal.component';
import { ContextMenuComponent } from 'src/app/components/context-menu.component';
import { EnvironmentLogsComponent } from 'src/app/components/environment-logs.component';
import { HeadersListComponent } from 'src/app/components/headers-list.component';
import { SettingsModalComponent } from 'src/app/components/settings-modal.component';
import { WelcomeModalComponent } from 'src/app/components/welcome-modal.component';
import { Config } from 'src/app/config';
import { AutocompleteDirective } from 'src/app/directives/autocomplete.directive';
import { InputNumberDirective } from 'src/app/directives/input-number.directive';
import { MousewheelUpdateDirective } from 'src/app/directives/mousewheel-update.directive';
import { ValidPathDirective } from 'src/app/directives/valid-path.directive';
import { MarkedOptionsFactory } from 'src/app/modules-config/markdown-factory';
import { AlertService } from 'src/app/services/alert.service';
import { AnalyticsService } from 'src/app/services/analytics.service';
import { AuthService } from 'src/app/services/auth.service';
import { DataService } from 'src/app/services/data.service';
import { EnvironmentsService } from 'src/app/services/environments.service';
import { EventsService } from 'src/app/services/events.service';
import { ServerService } from 'src/app/services/server.service';
import { SettingsService } from 'src/app/services/settings.service';
import { UpdateService } from 'src/app/services/update.service';
import { AppComponent } from './app.component';

@NgModule({
  declarations: [
    AppComponent,
    InputNumberDirective,
    ValidPathDirective,
    MousewheelUpdateDirective,
    ContextMenuComponent,
    AutocompleteDirective,
    WelcomeModalComponent,
    SettingsModalComponent,
    ChangelogModalComponent,
    EnvironmentLogsComponent,
    HeadersListComponent,
    BannerComponent
  ],
  imports: [
    AceEditorModule,
    BrowserAnimationsModule,
    BrowserModule,
    DragulaModule.forRoot(),
    FormsModule,
    HttpClientModule,
    NgbModule.forRoot(),
    MarkdownModule.forRoot({ markedOptions: { provide: MarkedOptions, useFactory: MarkedOptionsFactory } }),
    AngularFireModule.initializeApp(Config.firebaseConfig),
    AngularFireAuthModule,
    AngularFirestoreModule,
    ReactiveFormsModule
  ],
  providers: [
    AlertService,
    AnalyticsService,
    AuthService,
    EnvironmentsService,
    EventsService,
    ServerService,
    SettingsService,
    UpdateService,
    DataService,
    { provide: FirestoreSettingsToken, useValue: {} }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
