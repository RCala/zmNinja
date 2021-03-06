/* jshint -W041 */

/* jslint browser: true*/
/* global cordova,StatusBar,angular,console ,PushNotification*/

//--------------------------------------------------------------------------
// This factory interacts with the ZM Event Server
// over websockets and is responsible for rendering real time notifications
//--------------------------------------------------------------------------

angular.module('zmApp.controllers')
    .factory('EventServer', ['NVRDataModel', '$rootScope', '$websocket', '$ionicPopup', '$timeout', '$q', 'zm', '$ionicPlatform', '$cordovaMedia', '$translate', function(NVRDataModel, $rootScope, $websocket, $ionicPopup, $timeout, $q, zm, $ionicPlatform, $cordovaMedia, $translate)
    {

        var lastEventServerCheck = Date.now();
        var ws;

        var localNotificationId = 0;
        var pushInited = false;
        var isTimerOn = false;
        var initCalled = false;


        //--------------------------------------------------------------------------
        // called when the websocket is opened
        //--------------------------------------------------------------------------
        function openHandshake()
        {
            NVRDataModel.log ("Inside openHandshake");
            var loginData = NVRDataModel.getLogin();
            if (loginData.isUseEventServer == false || loginData.eventServer == "")
            {
                NVRDataModel.log("openHandShake: no event server");
                return;
            }

            if (typeof ws == 'undefined') {
                NVRDataModel.debug ("websocket is undefined, need to create ws before I can sent auth");
                ws = $websocket(loginData.eventServer,{reconnectIfNotNormalClose: false});
               // ws.onOpen(openHandshake);
               // return;
            }

            NVRDataModel.log("openHandshake: Websocket open, sending Auth");
            ws.send(
            {
                event:'auth',
                data: {
                        user: loginData.username,
                        password: loginData.password    
                }
                
            });

            if ($rootScope.apnsToken != '')
            {
                var plat = $ionicPlatform.is('ios') ? 'ios' : 'android';
                var ld = NVRDataModel.getLogin();
                var pushstate = "enabled";
                if (ld.disablePush == true)
                    pushstate = "disabled";

                NVRDataModel.debug("openHandShake: state of push is " + pushstate);
                // let's do this only if disabled. If enabled, I suppose registration
                // will be called?
                //if (ld.disablePush)
                if (1)
                {
                    //console.log ("HANDSHAKE MESSAGE WITH "+$rootScope.monstring);
                    ws.send(
                    {
                        event:'push',
                        data :{
                            type: 'token',
                            platform: plat,
                            token: $rootScope.apnsToken,
                            monlist:$rootScope.monstring,
                            intlist:$rootScope.intstring,
                            state: pushstate
                        }
                    });
                }
            }

        }

        //--------------------------------------------------------------------------
        // Called once at app start. Does a lazy definition of websockets open
        //--------------------------------------------------------------------------
        function init()
        {

            $rootScope.isAlarm = 0;
            $rootScope.alarmCount = "0";

            isTimerOn = false;


            var d = $q.defer();

            var loginData = NVRDataModel.getLogin();

            //console.log ("INIT GOT " + JSON.stringify(loginData));

            if (loginData.isUseEventServer == false || !loginData.eventServer)
            {
                NVRDataModel.log("No Event Server present. Not initializing");
                d.reject("false");
                return d.promise;
            }

            //if (!$rootScope.apnsToken)
            if (!pushInited) pushInit();

            console.log ("WS TYPEOF="+ typeof ws);
           // console.log ("WS="+JSON.stringify(ws));
            if (typeof ws !== 'undefined')
            {
                NVRDataModel.debug("websocket already initialized --Forcing close");
                ws.close(true);
                ws=undefined;
                
            }

            NVRDataModel.log("Initializing Websocket with URL " +
                loginData.eventServer );
           /* ws = $websocket.$new(
            {
                url: loginData.eventServer,
                reconnect: true,
                reconnectInterval: 60000,
                lazy: true
            });*/

            ws = $websocket(loginData.eventServer,{reconnectIfNotNormalClose: false});
            ws.onOpen(openHandshake);

            initCalled = true;
            // Transmit auth information to server              
           // ws.$on('$open', openHandshake);

           if (ws) {
               ws.onErrorCallbacks = [];
               NVRDataModel.debug("Removing error handlers for websocket");
           }
            NVRDataModel.debug("Setting up websocket error handler");
            //ws.$on('$error', function(e)
            ws.onError(function (e)
            {

                // we don't need this check as I changed reconnect interval to 60s
                //if ((Date.now() - lastEventServerCheck > 30000.0) || firstError)
            


                NVRDataModel.debug("Websocket Errorhandler called");

                if (!initCalled) {
                    NVRDataModel.log ("Ignoring websocket error as init not yet called");
                    return;
                }

                $timeout(function()
                {
                    NVRDataModel.displayBanner('error', ['Event Server connection error']);
                }, 3000); // leave 3 seconds for transitions
                
                lastEventServerCheck = Date.now();
                if (typeof ws !== 'undefined'){
                    NVRDataModel.debug ("-->Forcing socket close");
                    ws.close(true);

                }
                    
                ws = undefined;
            
                NVRDataModel.log ("Will try to reconnect in 10 sec..");
                if (!isTimerOn) 
                {
                    $timeout ( init, 10000 );
                    isTimerOn = true;
                }
                
              
                //console.log ("VALUE TIME " + lastEventServerCheck);
                //console.log ("NOW TIME " + Date.now());
            });

            ws.onClose( function ()
           // ws.$on('$close', function()
            {
                NVRDataModel.log("Websocket closed");
                ws = undefined;

                var ld = NVRDataModel.getLogin();
        
                if (ld.isUseEventServer && !isTimerOn) {
                    // this means remote error, because zmN still
                    // wants it on
                    $timeout ( init, 10000 );
                    isTimerOn = true;
                }

            });

            // Handles responses back from ZM ES

            ws.onMessage (function (str)
           // ws.$on('$message', function(str)
    
            {
                str = JSON.parse(str.data);
                //console.log ("FULL MESSAGE="+JSON.stringify(str.data));
                NVRDataModel.debug("Real-time event: " + JSON.stringify(str));

                // Error messages
                if (str.status != 'Success')
                {
                    NVRDataModel.log("Event Error: " + JSON.stringify(str));

                    if (str.reason == 'APNSDISABLED')
                    {
                        ws.close();
                        NVRDataModel.displayBanner('error', ['Event Server: APNS disabled'], 2000, 6000);
                        $rootScope.apnsToken = "";
                    }

                }

                if (str.status == 'Success' && (str.event == 'auth'))
                {
                    if (str.version == undefined)
                        str.version = "0.1";
                    if (NVRDataModel.versionCompare(str.version, zm.minEventServerVersion) == -1)
                    {
                        $rootScope.zmPopup = $ionicPopup.alert(
                        {
                            title: $translate.instant('kEventServerVersionTitle'),
                            template: $translate.instant('kEventServerVersionBody1') + " " + str.version + ". " + $translate.instant('kEventServerVersionBody2') + " "+
                                zm.minEventServerVersion,
                                okText: $translate.instant('kButtonOk'),
                                cancelText: $translate.instant('kButtonCancel'),
                        });
                    }

                }

                if (str.status == 'Success' && str.event == 'alarm') // new events
                {

                    var localNotText;
                    // ZMN specific hack for Event Server
                    if (str.supplementary != 'true')
                    {
                        new Audio('sounds/blop.mp3').play();
                        localNotText = "";
                        $rootScope.isAlarm = 1;

                        // Show upto a max of 99 when it comes to display
                        // so aesthetics are maintained
                        if ($rootScope.alarmCount == "99")
                        {
                            $rootScope.alarmCount = "99+";
                        }
                        if ($rootScope.alarmCount != "99+")
                        {
                            $rootScope.alarmCount = (parseInt($rootScope.alarmCount) + 1).toString();
                        }

                    }
                    else
                    {
                        NVRDataModel.debug("received supplementary event information over websockets");
                    }
                    var eventsToDisplay = [];
                    var listOfMonitors = [];
                    for (var iter = 0; iter < str.events.length; iter++)
                    {
                        // lets stack the display so they don't overwrite
                        //eventsToDisplay.push(str.events[iter].Name + ": latest new alarm (" + str.events[iter].EventId + ")");
                        var txt = str.events[iter].EventId;
                        if (str.events[iter].Cause) { txt = str.events[iter].Cause;}
                        eventsToDisplay.push(str.events[iter].Name + ": " + txt);
                        localNotText = localNotText + str.events[iter].Name + ": " +txt+ ",";
                        listOfMonitors.push(str.events[iter].MonitorId);

                    }
                    localNotText = localNotText.substring(0, localNotText.length - 1);

                    // if we are in background, do a local notification, else do an in app display
                    if (!NVRDataModel.isBackground())
                    {

                        //emit alarm details - this is when received over websockets
                        $rootScope.$broadcast('alarm',
                        {
                            message: listOfMonitors
                        });

                        if (str.supplementary != 'true')
                        {

                            NVRDataModel.debug("App is in foreground, displaying banner");
                            if (eventsToDisplay.length > 0)
                            {

                                if (eventsToDisplay.length == 1)
                                {
                                    //console.log("Single Display: " + eventsToDisplay[0]);
                                    NVRDataModel.displayBanner('alarm', [eventsToDisplay[0]], 5000, 5000);
                                }
                                else
                                {
                                    NVRDataModel.displayBanner('alarm', eventsToDisplay,
                                        5000, 5000 * eventsToDisplay.length);
                                }

                            }
                        }
                    }

                } //end of success handler

            });
            d.resolve("true");
            return (d.promise);

        }

        function disconnect()
        {
           
            if (typeof ws === 'undefined') {
                NVRDataModel.log("Event server socket is empty, nothing to disconnect");
                return;
            }
                
            NVRDataModel.log("Disconnecting and deleting Event Server socket...");
           // ws.$close();
           ws.close(true); // force close
           // ws.$un('open');
           // ws.$un('close');
           // ws.$un('message');
            ws = undefined;

        }

        //--------------------------------------------------------------------------
        // Send an arbitrary object to the Event Serve
        // currently planned to use it for device token
        // isForce =1 when you need to send the message even
        // if config says ES is off. This may happen when 
        // you turn off ES and then we need sendMessage to
        // let ZMES know not to send us messages
        //--------------------------------------------------------------------------
        function sendMessage(type, obj, isForce)
        {
            var ld = NVRDataModel.getLogin();
            if (ld.isUseEventServer == false && isForce != 1)
            {
                NVRDataModel.debug("Not sending WSS message as event server is off");
                return;
            }

            if (typeof ws === 'undefined')
            {
                NVRDataModel.debug("Event server not initalized, not sending message");
                return;
            }

            console.log (">>>>>>>>>>>>>>>>>EVENT SERVER SENDING: type="+type+" DATA="+JSON.stringify(obj));
            ws.send({
                'event':type, 
                'data': obj
            });

            /*if (ws.$status() == ws.$CLOSED)
            {
                NVRDataModel.log("Websocket was closed, trying to re-open");
                ws.$un('$open');
                //ws.$on ('$open', openHandshake);
                ws.$open();

                ws.$on('$open', openHandshake, function()
                {

                    //console.log(" sending " + type + " " +
                    //  JSON.stringify(obj));
                   //console.log("sending " + type + " " + JSON.stringify(obj));
                    ws.$emit(type, obj);

                    ws.$un('$open');
                    ws.$on('$open', openHandshake);

                });

            }
            else*
            {
                ws.send(type, obj);
               // console.log("sending " + type + " " + JSON.stringify(obj));
            }*/

        }

        //--------------------------------------------------------------------------
        // Called each time we resume 
        //--------------------------------------------------------------------------
        function refresh()
        {
            var loginData = NVRDataModel.getLogin();

            if ((!loginData.eventServer) || (loginData.isUseEventServer == false))
            {
                NVRDataModel.log("No Event Server configured, skipping refresh");

                // Let's also make sure that if the socket was open 
                // we close it - this may happen if you disable it after using it

                if (typeof ws !== 'undefined')
                {
                    /*(if (ws.$status() != ws.$CLOSED)
                    {
                        NVRDataModel.debug("Closing open websocket as event server was disabled");
                        ws.$close();
                    }*/
                }

                return;
            }

            if (typeof ws === 'undefined')
            {
                NVRDataModel.debug("Calling websocket init");
                init();
            }

            // refresh is called when 
            // The following situations will close the socket
            // a) In iOS the client went to background -- we should reconnect
            // b) The Event Server died 
            // c) The network died
            // Seems to me in all cases we should give re-open a shot

            /*if (ws.$status() == ws.$CLOSED)
            {
                NVRDataModel.log("Websocket was closed, trying to re-open");
                ws.$open();
            }*/

        }

        function pushInit()
        {
            NVRDataModel.log(">>>Setting up push registration");
            var push;
            var mediasrc;
            var media;
            var ld = NVRDataModel.getLogin();

            var plat = $ionicPlatform.is('ios') ? 'ios' : 'android';

            if ($rootScope.platformOS == 'desktop')
            {
                NVRDataModel.log("Desktop instance, not setting up push. Websockets only, I hope");
                return;
            }

            if (plat == 'ios')
            {
                mediasrc = "sounds/blop.mp3";
                push = PushNotification.init(

                    {
                        "ios":
                        {
                            "alert": "true",
                            "badge": "true",
                            "sound": ld.soundOnPush,
                            //"sound": "true",
                            "clearBadge": "true",
                           //"fcmSandbox": "true"
                        }
                    }

                );

            }
            else
            {
                mediasrc = "/android_asset/www/sounds/blop.mp3";
                var android_media_file = "blop";

                push = PushNotification.init(

                    {
                        "android":
                        {
                           // "senderID": zm.gcmSenderId,
                            "icon": "ic_stat_notification",
                            sound: "true",
                            vibrate: ld.vibrateOnPush
                                //"sound": android_media_file
                        }
                    }

                );

            }

            // console.log("*********** MEDIA BLOG IS " + mediasrc);
            media = $cordovaMedia.newMedia(mediasrc);

            push.on('registration', function(data)
            {
                pushInited = true;
                NVRDataModel.debug("Push Notification registration ID received: " + JSON.stringify(data));
                $rootScope.apnsToken = data.registrationId;

                var plat = $ionicPlatform.is('ios') ? 'ios' : 'android';
                var ld = NVRDataModel.getLogin();
                var pushstate = "enabled";
                if (ld.disablePush == true)
                    pushstate = "disabled";

                // now at this stage, if this is a first registration
                // zmeventserver will have no record of this token
                // so we need to make sure we send it a legit list of 
                // monitors otherwise users will get notifications for monitors
                // their login is not supposed to see. Refer #391

                var monstring='';
                var intstring='';
                NVRDataModel.getMonitors()
                .then (function(succ) {
                    var mon = succ;

                    if (ld.eventServerMonitors !='' ) {
                        // load previous monlist and intlist
                        // so we don't overwrite 
                        monstring = ld.eventServerMonitors;
                        intstring = ld.eventServerInterval;
                        NVRDataModel.debug ("loading saved monitor list and interval of "+monstring+">>"+intstring);

                    }

                    else { // build new list

                        for (var i = 0; i < mon.length; i++) {
                            monstring = monstring + mon[i].Monitor.Id + ",";
                            intstring = intstring + '0,';
                        }
                        if (monstring.charAt(monstring.length - 1) == ',')
                            monstring = monstring.substr(0, monstring.length - 1);
    
                        if (intstring.charAt(intstring.length - 1) == ',')
                            intstring = intstring.substr(0, intstring.length - 1);

                    }

                 

                    //console.log ("WUTPUT SENDING REG WITH "+monstring);

                    $rootScope.monstring = monstring;
                    $rootScope.intstring = intstring;

                    sendMessage('push',
                    {
                        type: 'token',
                        platform: plat,
                        token: $rootScope.apnsToken,
                        monlist: monstring,
                        intlist: intstring,
                        state: pushstate
                    }, 1);

                }, 
                function (err)
                {
                    NVRDataModel.log ("Could not get monitors, can't send push reg");
                });     

            });

            push.on('notification', function(data)
            {

                NVRDataModel.debug("received push notification");

                var ld = NVRDataModel.getLogin();
                if (ld.isUseEventServer == false)
                {
                    NVRDataModel.debug("received push notification, but event server disabled. Not acting on it");
                    return;
                }

                if (data.additionalData.foreground == false)
                {
                    // This means push notification tap in background

                    NVRDataModel.debug("*** PUSH NOTFN.>>>>" + JSON.stringify(data));

                    // set tappedMid to monitor 
                    //*** PUSH DATA>>>>{"sound":"blop","message":"Alarms: Basement (2854) ","additionalData":{"mid":"2","coldstart":false,"collapse_key":"do_not_collapse","foreground":false}}

                    if (data.additionalData.dismissed != undefined || data.additionalData.coldstart == true || $rootScope.platformOS == 'ios') // user tapped on notification
                    // in iOS case, since content-av is not there this notification won't be called unless you tap
                    {
                        NVRDataModel.debug("Notification Tapped");
                        $rootScope.alarmCount = "0";
                        $rootScope.isAlarm = 0;
                        $rootScope.tappedNotification = 1;

                        var mid;
                        var eid;

                        // we are using FCM on IOS too 
                      /*  if ($rootScope.platformOS == 'ios') {
                            mid = data.additionalData.gcm.notification.mid;
                            eid = data.additionalData.gcm.notification.eid;

                        }
                        else {*/

                        mid = data.additionalData.mid;
                        eid = data.additionalData.eid;
                       // }
                        


                        // if Multiple mids, take the first one
                        var mi = mid.indexOf(',');
                        if (mi > 0)
                        {
                            mid = mid.slice(0, mi);
                        }
                        mid = parseInt(mid);

                        $rootScope.tappedMid = mid;
                        $rootScope.tappedEid = eid;
                        NVRDataModel.log("Push notification: Tapped Monitor taken as:" + $rootScope.tappedMid);

                        if ($rootScope.platformOS == 'ios')
                        {

                            NVRDataModel.debug("iOS only: clearing background push");
                            push.finish(function()
                            {
                                NVRDataModel.debug("processing of push data is finished");
                            });
                        }

                    }
                    else {
                        NVRDataModel.debug ("App started via icon, not notification");
                        $rootScope.tappedNotification = 0;
                        $rootScope.tappedEid = 0;
                        $rootScope.tappedMid = 0;
                    }
                    $rootScope.$broadcast('process-push');

                }
                else // app is foreground
                {

                    // this flag honors the HW mute button. Go figure
                    // http://ilee.co.uk/phonegap-plays-sound-on-mute/

                    NVRDataModel.debug ("--> *** PUSH IN FOREGROUND");

                    $rootScope.tappedNotification = 0;
                    $rootScope.tappedEid = 0;
                    $rootScope.tappedMid = 0;

                    if (ld.soundOnPush)
                    {
                        media.play(
                        {
                            playAudioWhenScreenIsLocked: false
                        });
                    }

                    var str = data.message;
                    // console.log ("***STRING: " + str + " " +str.status);
                    var eventsToDisplay = [];

                    NVRDataModel.displayBanner('alarm', [str], 0, 5000 * eventsToDisplay.length);

                    $rootScope.isAlarm = 1;

                    // Show upto a max of 99 when it comes to display
                    // so aesthetics are maintained
                    if ($rootScope.alarmCount == "99")
                    {
                        $rootScope.alarmCount = "99+";
                    }
                    if ($rootScope.alarmCount != "99+")
                    {
                        $rootScope.alarmCount = (parseInt($rootScope.alarmCount) + 1).toString();
                    }
                }
            });

            push.on('error', function(e)
            {
                NVRDataModel.debug("Push error: " + JSON.stringify(e));
                // console.log("************* PUSH ERROR ******************");
            });
        }

        return {
            refresh: refresh,
            init: init,
            sendMessage: sendMessage,
            pushInit: pushInit,
            disconnect: disconnect

        };

    }]);
