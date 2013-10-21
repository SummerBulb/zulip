var subs = (function () {

var exports = {};

var next_sub_id = 0;

function get_color() {
    var used_colors = stream_data.get_colors();
    var color = stream_color.pick_color(used_colors);
    return color;
}

exports.update_all_messages_link = function () {
    // Show or hide the "All messages" link, depending on whether
    // the user has any subscriptions hidden from home view.
    var all_messages = $("#global_filters [data-name='all']")[0];

    if (stream_data.all_subscribed_streams_are_in_home_view()) {
        $(all_messages).addClass('hidden-filter');
    } else {
        $(all_messages).removeClass('hidden-filter');
    }
};

function should_list_all_streams() {
    return page_params.domain !== 'mit.edu';
}

exports.stream_id = function (stream_name) {
    var sub = stream_data.get_sub(stream_name);
    if (sub === undefined) {
        blueslip.error("Tried to get subs.stream_id for a stream user is not subscribed to!");
        return 0;
    }
    return parseInt(sub.id, 10);
};

function set_stream_property(stream_name, property, value) {
    $.ajax({
        type:     'POST',
        url:      '/json/subscriptions/property',
        dataType: 'json',
        data: {
            "property": property,
            "stream_name": stream_name,
            "value": value
        },
        timeout:  10*1000
    });
}

function stream_home_view_clicked(e) {
    var sub_row = $(e.target).closest('.subscription_row');
    var stream = sub_row.find('.subscription_name').text();
    subs.toggle_home(stream);
}

function update_in_home_view(sub, value) {
    if (sub.in_home_view === value) {
        return;
    }
    sub.in_home_view = value;

    setTimeout(function () {
        var scroll_offset, saved_ypos;
        // Save our current scroll position
        if (ui.home_tab_obscured()) {
            saved_ypos = window.scrollY;
        } else if (home_msg_list === current_msg_list) {
            scroll_offset = current_msg_list.selected_row().offset().top - viewport.scrollTop();
        }

        home_msg_list.clear({clear_selected_id: false});

        // Recreate the home_msg_list with the newly filtered all_msg_list
        add_messages(all_msg_list.all(), home_msg_list);

        // Ensure we're still at the same scroll position
        if (ui.home_tab_obscured()) {
            window.scrollTo(0, saved_ypos);
        } else if (home_msg_list === current_msg_list) {
            // We pass use_closest to handle the case where the
            // currently selected message is being hidden from the
            // home view
            home_msg_list.select_id(home_msg_list.selected_id(),
                                    {use_closest: true});
            if (current_msg_list.selected_id() !== -1) {
                viewport.scrollTop(current_msg_list.selected_row().offset().top - scroll_offset);
            }
        }

        // In case we added messages to what's visible in the home view, we need to re-scroll to make
        // sure the pointer is still visible. We don't want the auto-scroll handler to move our pointer
        // to the old scroll location before we have a chance to update it.
        recenter_pointer_on_display = true;
        suppress_scroll_pointer_update = true;

        if (! home_msg_list.empty()) {
            process_loaded_for_unread(home_msg_list.all());
        }
    }, 0);

    exports.update_all_messages_link();
    stream_list.set_in_home_view(sub.name, sub.in_home_view);

    var in_home_view_checkbox = $("#subscription_" + sub.id + " #sub_setting_in_home_view .sub_setting_control");
    in_home_view_checkbox.attr('checked', value);
}

exports.toggle_home = function (stream_name) {
    var sub = stream_data.get_sub(stream_name);
    update_in_home_view(sub, ! sub.in_home_view);
    set_stream_property(stream_name, 'in_home_view', sub.in_home_view);
};

function update_stream_notifications(sub, value) {
    var in_home_view_checkbox = $("#subscription_" + sub.id + " #sub_setting_notifications .sub_setting_control");
    in_home_view_checkbox.attr('checked', value);
    sub.notifications = value;
}

function update_stream_name(sub, new_name) {
    if (sub === undefined) {
        // This isn't a stream we know about, so ignore it.
        return;
    }

    // Rename the stream internally.
    var old_name = sub.name;
    stream_data.delete_sub(old_name);
    sub.name = new_name;
    stream_data.add_sub(new_name, sub);

    // Update the stream sidebar.
    exports.reload_subscriptions({clear_first: true});

    // Update the message feed.
    _.each([home_msg_list, current_msg_list, all_msg_list], function (list) {
        list.change_display_recipient(old_name, new_name);
    });
}

function stream_notifications_clicked(e) {
    var sub_row = $(e.target).closest('.subscription_row');
    var stream = sub_row.find('.subscription_name').text();

    var sub = stream_data.get_sub(stream);
    sub.notifications = ! sub.notifications;
    set_stream_property(stream, 'notifications', sub.notifications);
}

exports.set_color = function (stream_name, color) {
    var sub = stream_data.get_sub(stream_name);
    stream_color.update_stream_color(sub, stream_name, color, {update_historical: true});
    set_stream_property(stream_name, 'color', color);
};

function create_sub(stream_name, attrs) {
    var sub = stream_data.get_sub(stream_name);
    if (sub !== undefined) {
        // We've already created this subscription, no need to continue.
        return sub;
    }

    // Our internal data structure for subscriptions is mostly plain dictionaries,
    // so we just reuse the attrs that are passed in to us, but we encapsulate how
    // we handle subscribers.
    var subscriber_emails = attrs.subscribers;
    var raw_attrs = _.omit(attrs, 'subscribers');

    sub = _.defaults(raw_attrs, {
        name: stream_name,
        id: next_sub_id++,
        render_subscribers: page_params.domain !== 'mit.edu' || attrs.invite_only === true,
        subscribed: true,
        in_home_view: true,
        invite_only: false,
        notifications: page_params.notify_for_streams_by_default
    });

    stream_data.set_subscribers(sub, subscriber_emails);

    if (!sub.color) {
        sub.color = get_color();
    }

    stream_data.add_sub(stream_name, sub);
    $(document).trigger($.Event('sub_obj_created.zulip', {sub: sub}));
    return sub;
}

function button_for_sub(sub) {
    var id = parseInt(sub.id, 10);
    return $("#subscription_" + id + " .sub_unsub_button");
}

function settings_for_sub(sub) {
    var id = parseInt(sub.id, 10);
    return $("#subscription_settings_" + id);
}

exports.show_settings_for = function (stream_name) {
    settings_for_sub(stream_data.get_sub(stream_name)).collapse('show');
};

function add_email_hint(row) {
    // Add a popover explaining stream e-mail addresses on hover.
    var hint_id = "#email-address-hint-" + row.id;
    var email_address_hint = $(hint_id);
    email_address_hint.popover({"placement": "bottom",
                "title": "Email integration",
                "content": templates.render('email_address_hint'),
                "trigger": "manual"});
    $("body").on("mouseover", hint_id, function (e) {
        email_address_hint.popover('show');
        e.stopPropagation();
    });
    $("body").on("mouseout", hint_id, function (e) {
        email_address_hint.popover('hide');
        e.stopPropagation();
    });
}

function add_sub_to_table(sub) {
    $('#create_stream_row').after(templates.render(
        'subscription',
        _.extend(sub, {'allow_rename': page_params.show_admin})));
    settings_for_sub(sub).collapse('show');
    add_email_hint(sub);
}

function format_member_list_elem(name, email) {
    return name + (email ? ' <' + email + '>' : '');
}

function add_to_member_list(ul, name, email) {
    $('<li>').prependTo(ul).text(format_member_list_elem(name, email));
}

function mark_subscribed(stream_name, attrs) {
    var sub = stream_data.get_sub(stream_name);

    if (sub === undefined) {
        // Create a new stream.
        sub = create_sub(stream_name, attrs);
        add_sub_to_table(sub);
    } else if (! sub.subscribed) {
        // Add yourself to a stream we already know about client-side.
        var color = get_color();
        exports.set_color(stream_name, color);
        sub.subscribed = true;
        sub.subscribers = Dict.from_array(attrs.subscribers);
        var settings = settings_for_sub(sub);
        var button = button_for_sub(sub);
        if (button.length !== 0) {
            button.text("Unsubscribe").removeClass("btn-primary");
            // Add the user to the member list if they're currently
            // viewing the members of this stream
            if (sub.render_subscribers && settings.hasClass('in')) {
                var members = settings.find(".subscriber_list_container ul");
                add_to_member_list(members, page_params.fullname, page_params.email);
            }
        } else {
            add_sub_to_table(sub);
        }

        // Display the swatch and subscription settings
        var sub_row = settings.closest('.subscription_row');
        sub_row.find(".color_swatch").addClass('in');
        sub_row.find(".regular_subscription_settings").collapse('show');
    } else {
        // Already subscribed
        return;
    }

    if (current_msg_list.narrowed) {
        current_msg_list.update_trailing_bookend();
    }

    // Update unread counts as the new stream in sidebar might
    // need its unread counts re-calculated
    process_loaded_for_unread(all_msg_list.all());

    $(document).trigger($.Event('subscription_add_done.zulip', {sub: sub}));
}

function mark_unsubscribed(stream_name) {
    var sub = stream_data.get_sub(stream_name);

    if (sub === undefined) {
        // We don't know about this stream
        return;
    } else if (sub.subscribed) {
        stream_list.remove_narrow_filter(stream_name, 'stream');
        sub.subscribed = false;
        button_for_sub(sub).text("Subscribe").addClass("btn-primary");
        var settings = settings_for_sub(sub);
        if (settings.hasClass('in')) {
            settings.collapse('hide');
        }

        // Hide the swatch and subscription settings
        var sub_row = settings.closest('.subscription_row');
        sub_row.find(".color_swatch").removeClass('in');
        if (sub.render_subscribers) {
            // TODO: having a completely empty settings div messes
            // with Bootstrap's collapser.  We currently just ensure
            // that it's not empty on the MIT realm, even though it
            // looks weird
            sub_row.find(".regular_subscription_settings").collapse('hide');
        }
    } else {
        // Already unsubscribed
        return;
    }

    if (current_msg_list.narrowed) {
        current_msg_list.update_trailing_bookend();
    }

    $(document).trigger($.Event('subscription_remove_done.zulip', {sub: sub}));
}

$(function () {
    $(document).on('subscription_add.zulip', function (e) {
        mark_subscribed(e.subscription.name, e.subscription);
    });
    $(document).on('subscription_remove.zulip', function (e) {
        mark_unsubscribed(e.subscription.name);
    });
});

exports.receives_notifications = function (stream_name) {
    var sub = stream_data.get_sub(stream_name);
    if (sub === undefined) {
        return false;
    }
    return sub.notifications;
};

function populate_subscriptions(subs, subscribed) {
    var sub_rows = [];
    subs.sort(function (a, b) {
        return util.strcmp(a.name, b.name);
    });
    subs.forEach(function (elem) {
        var stream_name = elem.name;
        var sub = create_sub(stream_name, {color: elem.color, in_home_view: elem.in_home_view,
                                           invite_only: elem.invite_only,
                                           notifications: elem.notifications, subscribed: subscribed,
                                           email_address: elem.email_address,
                                           subscribers: elem.subscribers});
        sub_rows.push(sub);
    });

    stream_list.sort_narrow_list();
    return sub_rows;
}

exports.reload_subscriptions = function (opts) {
    var on_success;
    opts = _.defaults({}, opts, {clear_first: false, custom_callbacks: false});

    if (! opts.custom_callbacks) {
        on_success = function (data) {
                         if (data) {
                             populate_subscriptions(data.subscriptions, true);
                         }
                     };
    }

    if (opts.clear_first) {
        // Only clear the subscriptions just before we're ready to repopulate,
        // otherwise the stream list will go blank in the UI while we wait for
        // the network request to finish.
        var existing_callback = on_success;
        on_success = function (data) {
            stream_data.clear_subscriptions();
            stream_list.remove_all_narrow_filters();
            existing_callback(data);
        };
    }

    return $.ajax({
                    type:     'POST',
                    url:      '/json/subscriptions/list',
                    dataType: 'json',
                    timeout:  10*1000,
                    success: on_success
    });
};

exports.setup_page = function () {
    util.make_loading_indicator($('#subs_page_loading_indicator'));

    function populate_and_fill(data_for_streams, subscription_data) {
        var all_streams = [];
        var our_subs = [];
        var sub_rows = [];

        /* arguments are [ "success", statusText, jqXHR ] */
        if (data_for_streams.length > 2 && data_for_streams[2]) {
            var stream_response = JSON.parse(data_for_streams[2].responseText);
            _.each(stream_response.streams, function (stream) {
                all_streams.push(stream.name);
            });
        }
        if (subscription_data.length > 2 && subscription_data[2]) {
            var subs_response = JSON.parse(subscription_data[2].responseText);
            our_subs = subs_response.subscriptions;
        }

        // All streams won't contain invite-only streams,
        // or anything at all if should_list_all_streams() is false
        _.each(our_subs, function (stream) {
            if (_.indexOf(all_streams, stream.name) === -1) {
                all_streams.push(stream.name);
            }
        });

        populate_subscriptions(our_subs, true);

        all_streams.forEach(function (stream) {
            var sub = stream_data.get_sub(stream);
            if (!sub) {
                sub = create_sub(stream, {subscribed: false});
            }
            sub = _.extend(sub, {'allow_rename': page_params.show_admin});
            sub_rows.push(sub);
        });

        sub_rows.sort(function (streama, streamb) {
            if (streama.subscribed && !streamb.subscribed) {
                return -1;
            } else if (streamb.subscribed && !streama.subscribed) {
                return 1;
            } else {
                return util.strcmp(streama.name, streamb.name);
            }
        });

        $('#subscriptions_table').empty();
        var rendered = templates.render('subscription_table_body', {subscriptions: sub_rows});
        $('#subscriptions_table').append(rendered);

        _.each(sub_rows, function (row) {
            add_email_hint(row);
        });

        util.destroy_loading_indicator($('#subs_page_loading_indicator'));
        $(document).trigger($.Event('subs_page_loaded.zulip'));
    }

    function failed_listing(xhr, error) {
        util.destroy_loading_indicator($('#subs_page_loading_indicator'));
        ui.report_error("Error listing streams or subscriptions", xhr, $("#subscriptions-status"));
    }

    var requests = [];
    if (should_list_all_streams()) {
        // This query must go first to prevent a race when we are not
        // listing all streams
        var req = $.ajax({
            type:     'POST',
            url:      '/json/get_public_streams',
            dataType: 'json',
            timeout:  10*1000
        });
        requests.push(req);
    } else {
        // Handing an object to $.when() means that it counts as a 'success' with the
        // object delivered directly to the callback
        requests.push({streams: []});
        $('#create_stream_button').val("Subscribe");
    }

    requests.push(exports.reload_subscriptions({custom_callbacks: true}));

    // Trigger finished callback when:
    // * Both AJAX requests are finished, if we sent themm both
    // * Just one AJAX is finished if should_list_all_streams() is false
    $.when.apply(this, requests).then(populate_and_fill, failed_listing);
};

exports.update_subscription_properties = function (stream_name, property, value) {
    var sub = stream_data.get_sub(stream_name);
    switch(property) {
    case 'color':
        stream_color.update_stream_color(sub, stream_name, value, {update_historical: true});
        break;
    case 'in_home_view':
        update_in_home_view(sub, value);
        break;
    case 'notifications':
        update_stream_notifications(sub, value);
        break;
    case 'name':
        update_stream_name(sub, value);
        break;
    default:
        blueslip.warn("Unexpected subscription property type", {property: property,
                                                                value: value});
    }
};

function ajaxSubscribe(stream) {
    // Subscribe yourself to a single stream.
    var true_stream_name;

    return $.ajax({
        type: "POST",
        url: "/json/subscriptions/add",
        dataType: 'json', // This seems to be ignored. We still get back an xhr.
        data: {"subscriptions": JSON.stringify([{"name": stream}]) },
        success: function (resp, statusText, xhr, form) {
            $("#create_stream_name").val("");

            var res = $.parseJSON(xhr.responseText);
            if (!$.isEmptyObject(res.already_subscribed)) {
                // Display the canonical stream capitalization.
                true_stream_name = res.already_subscribed[page_params.email][0];
                ui.report_success("Already subscribed to " + true_stream_name,
                                  $("#subscriptions-status"));
            }
            // The rest of the work is done via the subscribe event we will get
        },
        error: function (xhr) {
            ui.report_error("Error adding subscription", xhr, $("#subscriptions-status"));
            $("#create_stream_name").focus();
        }
    });
}

function ajaxUnsubscribe(stream) {
    $.ajax({
        type: "POST",
        url: "/json/subscriptions/remove",
        dataType: 'json', // This seems to be ignored. We still get back an xhr.
        data: {"subscriptions": JSON.stringify([stream]) },
        success: function (resp, statusText, xhr, form) {
            var name, res = $.parseJSON(xhr.responseText);
            $("#subscriptions-status").hide();
            // The rest of the work is done via the unsubscribe event we will get
        },
        error: function (xhr) {
            ui.report_error("Error removing subscription", xhr, $("#subscriptions-status"));
            $("#create_stream_name").focus();
        }
    });
}

function ajaxSubscribeForCreation(stream, principals, invite_only, announce) {
    // Subscribe yourself and possible other people to a new stream.
    return $.ajax({
        type: "POST",
        url: "/json/subscriptions/add",
        dataType: 'json', // This seems to be ignored. We still get back an xhr.
        data: {"subscriptions": JSON.stringify([{"name": stream}]),
               "principals": JSON.stringify(principals),
               "invite_only": JSON.stringify(invite_only),
               "announce": JSON.stringify(announce)
        },
        success: function (data) {
            $("#create_stream_name").val("");
            $("#subscriptions-status").hide();
            $('#stream-creation').modal("hide");
            // The rest of the work is done via the subscribe event we will get
        },
        error: function (xhr) {
            ui.report_error("Error creating stream", xhr, $("#subscriptions-status"));
            $('#stream-creation').modal("hide");
        }
    });
}

function people_cmp(person1, person2) {
    // Compares objects of the form used in people_list.
    var name_cmp = util.strcmp(person1.full_name, person2.full_name);
    if (name_cmp < 0) {
        return -1;
    } else if (name_cmp > 0) {
        return 1;
    }
    return util.strcmp(person1.email, person2.email);
}

// Within the new stream modal...
function update_announce_stream_state() {
    // If the stream is invite only, or everyone's added, disable
    // the "Announce stream" option. Otherwise enable it.
    var announce_stream_checkbox = $('#announce-new-stream input');
    var disable_it = false;
    var is_invite_only = $('input:radio[name=privacy]:checked').val() === 'invite-only';

    if (is_invite_only) {
        disable_it = true;
        announce_stream_checkbox.prop('checked', false);
    } else {
        disable_it = $('#user-checkboxes input').length
                    === $('#user-checkboxes input:checked').length;
    }

    announce_stream_checkbox.prop('disabled', disable_it);
}

function show_new_stream_modal() {
    var people_minus_you_and_internal_users = [];
    realm_people_dict.each(function (person) {
        if (person.email !== page_params.email) {
            people_minus_you_and_internal_users.push({"email": person.email,
                "full_name": person.full_name});
        }
    });

    $('#people_to_add').html(templates.render('new_stream_users', {
        users: people_minus_you_and_internal_users.sort(people_cmp)
    }));

    // Make the options default to the same each time:
    // public, "announce stream" on.
    $('#make-invite-only input:radio[value=public]').prop('checked', true);
    $('#announce-new-stream input').prop('disabled', false);
    $('#announce-new-stream input').prop('checked', true);

    $('#stream-creation').modal("show");
}

exports.invite_user_to_stream = function (user_email, stream_name, success, failure) {
    $.ajax({
        type: "POST",
        url: "/json/subscriptions/add",
        dataType: 'json',
        data: {"subscriptions": JSON.stringify([{"name": stream_name}]),
               "principals": JSON.stringify([user_email])},
        success: success,
        error: failure
    });
};



function inline_emails_into_subscriber_list(subs, email_dict) {
    // When we get subscriber lists from the back end, they are sent as user ids to
    // save bandwidth, but the legacy JS code wants emails.
    _.each(subs, function (sub) {
        if (sub.subscribers) {
            sub.subscribers = _.map(sub.subscribers, function (subscription) {
                return email_dict[subscription];
            });
        }
    });
}

$(function () {
    var i;

    inline_emails_into_subscriber_list(page_params.stream_list, page_params.email_dict);
    inline_emails_into_subscriber_list(page_params.unsubbed_info, page_params.email_dict);

    // Populate stream_info with data handed over to client-side template.
    populate_subscriptions(page_params.stream_list, true);
    populate_subscriptions(page_params.unsubbed_info, false);

    $("#subscriptions_table").on("submit", "#add_new_subscription", function (e) {
        e.preventDefault();

        if (!should_list_all_streams()) {
            ajaxSubscribe($("#create_stream_name").val());
            return;
        }

        var stream = $.trim($("#create_stream_name").val());
        var stream_status = compose.check_stream_existence(stream);
        if (stream_status === "does-not-exist") {
            $("#stream_name").text(stream);
            show_new_stream_modal();
        } else {
            ajaxSubscribe(stream);
        }
    });

    $('#stream_creation_form').on('change',
                                  '#user-checkboxes input, #make-invite-only input',
                                  update_announce_stream_state);

    // 'Check all' and 'Uncheck all' links
    $(document).on('click', '.subs_set_all_users', function (e) {
        $('#people_to_add :checkbox').attr('checked', true);
        e.preventDefault();
        update_announce_stream_state();
    });
    $(document).on('click', '.subs_unset_all_users', function (e) {
        $('#people_to_add :checkbox').attr('checked', false);
        e.preventDefault();
        update_announce_stream_state();
    });

    var announce_stream_docs = $("#announce-stream-docs");
    announce_stream_docs.popover({"placement": "right",
                                  "content": templates.render('announce_stream_docs'),
                                  "trigger": "manual"});
    $("body").on("mouseover", "#announce-stream-docs", function (e) {
        announce_stream_docs.popover('show');
        announce_stream_docs.data('popover').tip().css('z-index', 2000);
        e.stopPropagation();
    });
    $("body").on("mouseout", "#announce-stream-docs", function (e) {
        announce_stream_docs.popover('hide');
        e.stopPropagation();
    });

    $("#stream_creation_form").on("submit", function (e) {
        e.preventDefault();
        var stream = $.trim($("#create_stream_name").val());
        var principals = _.map(
            $("#stream_creation_form input:checkbox[name=user]:checked"),
            function (elem) {
                return $(elem).val();
            }
        );
        // You are always subscribed to streams you create.
        principals.push(page_params.email);
        ajaxSubscribeForCreation(stream,
            principals,
            $('#stream_creation_form input[name=privacy]:checked').val() === "invite-only",
            $('#announce-new-stream input').prop('checked')
            );
    });

    $("#subscriptions_table").on("click", ".sub_unsub_button", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var sub_row = $(e.target).closest('.subscription_row');
        var stream_name = sub_row.find('.subscription_name').text();
        var sub = stream_data.get_sub(stream_name);

        if (sub.subscribed) {
            ajaxUnsubscribe(stream_name);
        } else {
            ajaxSubscribe(stream_name);
        }
    });

    $("#subscriptions_table").on("show", ".subscription_settings", function (e) {
        var subrow = $(e.target).closest('.subscription_row');
        var colorpicker = subrow.find('.colorpicker');

        var color = stream_data.get_color(subrow.find('.subscription_name').text());
        stream_color.set_colorpicker_color(colorpicker, color);

        // To figure out the worst case for an expanded row's height, we do some math:
        // .subscriber_list_container max-height,
        // .subscriber_list_settings,
        // .regular_subscription_settings
        // .subscription_header line-height,
        // .subscription_header padding
        var expanded_row_size = 200 + 30 + 100 + 30 + 5;
        var cover = subrow.position().top + expanded_row_size -
            viewport.height() + $("#top_navbar").height() - viewport.scrollTop();
        if (cover > 0) {
            $('html, body').animate({
                scrollTop: viewport.scrollTop() + cover + 5
            });
        }

    });

    $("#subscriptions_table").on("click", ".sub_setting_checkbox", function (e) {
        var control = $(e.target).closest('.sub_setting_checkbox').find('.sub_setting_control');
        // A hack.  Don't change the state of the checkbox if we
        // clicked on the checkbox itself.
        if (control[0] !== e.target) {
            control.prop("checked", ! control.prop("checked"));
        }
    });
    $("#subscriptions_table").on("click", "#sub_setting_in_home_view", stream_home_view_clicked);
    $("#subscriptions_table").on("click", "#sub_setting_notifications", stream_notifications_clicked);

    $("#subscriptions_table").on("submit", ".subscriber_list_add form", function (e) {
        e.preventDefault();
        var sub_row = $(e.target).closest('.subscription_row');
        var stream = sub_row.find('.subscription_name').text();
        var text_box = sub_row.find('input[name="principal"]');
        var principal = $.trim(text_box.val());
        // TODO: clean up this error handling
        var error_elem = sub_row.find('.subscriber_list_container .alert-error');
        var warning_elem = sub_row.find('.subscriber_list_container .alert-warning');
        var list = sub_row.find('.subscriber_list_container ul');

        function invite_success(data) {
            text_box.val('');

            if (data.subscribed.hasOwnProperty(principal)) {
                error_elem.addClass("hide");
                warning_elem.addClass("hide");
                if (principal === page_params.email) {
                    // mark_subscribed adds the user to the member list
                    mark_subscribed(stream);
                } else {
                    add_to_member_list(list, people_dict.get(principal).full_name, principal);
                }
            } else {
                error_elem.addClass("hide");
                warning_elem.removeClass("hide").text("User already subscribed");
            }
        }

        function invite_failure(xhr) {
            warning_elem.addClass("hide");
            error_elem.removeClass("hide").text("Could not add user to this stream");
        }

        exports.invite_user_to_stream(principal, stream, invite_success, invite_failure);
    });

    $("#subscriptions_table").on("submit", ".rename-stream form", function (e) {
        e.preventDefault();

        var sub_row = $(e.target).closest('.subscription_row');
        var old_name_box = sub_row.find('.subscription_name');
        var old_name = old_name_box.text();
        var new_name_box = sub_row.find('input[name="new-name"]');
        var new_name = $.trim(new_name_box.val());

        $("#subscriptions-status").hide();

        $.ajax({
            type: "POST",
            url: "/json/rename_stream",
            dataType: 'json',
            data: {"old_name": old_name, "new_name": new_name},
            success: function (data) {
                new_name_box.val('');
                // Update all visible instances of the old name to the new name.
                old_name_box.text(new_name);
                sub_row.find(".email-address").text(data.email_address);

                ui.report_success("The stream has been renamed!", $("#subscriptions-status"));
            },
            error: function (xhr) {
                ui.report_error("Error renaming stream", xhr, $("#subscriptions-status"));
            }
        });
    });

    $("#subscriptions_table").on("show", ".regular_subscription_settings", function (e) {
        // We want 'show' events that originate from
        // 'regular_subscription_settings' divs not to trigger the
        // handler for the entire subscription_settings div
        e.stopPropagation();
    });

    $("#subscriptions_table").on("show", ".subscription_settings", function (e) {
        var sub_row = $(e.target).closest('.subscription_row');
        var stream = sub_row.find('.subscription_name').text();
        var warning_elem = sub_row.find('.subscriber_list_container .alert-warning');
        var error_elem = sub_row.find('.subscriber_list_container .alert-error');
        var list = sub_row.find('.subscriber_list_container ul');
        var indicator_elem = sub_row.find('.subscriber_list_loading_indicator');

        if (!stream_data.get_sub(stream).render_subscribers) {
            return;
        }

        warning_elem.addClass('hide');
        error_elem.addClass('hide');
        list.empty();

        util.make_loading_indicator(indicator_elem);

        $.ajax({
            type: "POST",
            url: "/json/get_subscribers",
            dataType: 'json', // This seems to be ignored. We still get back an xhr.
            data: {stream: stream},
            success: function (data) {
                util.destroy_loading_indicator(indicator_elem);
                var subscribers = _.map(data.subscribers, function (elem) {
                    var person = people_dict.get(elem);
                    if (person === undefined) {
                        return elem;
                    }
                    return format_member_list_elem(people_dict.get(elem).full_name, elem);
                });
                _.each(subscribers.sort().reverse(), function (elem) {
                    // add_to_member_list *prepends* the element,
                    // so we need to sort in reverse order for it to
                    // appear in alphabetical order.
                    add_to_member_list(list, elem);
                });
            },
            error: function (xhr) {
                util.destroy_loading_indicator(indicator_elem);
                error_elem.removeClass("hide").text("Could not fetch subscriber list");
            }
        });

        sub_row.find('input[name="principal"]').typeahead({
            source: typeahead_helper.private_message_typeahead_list,
            items: 4,
            highlighter: function (item) {
                var query = this.query;
                return typeahead_helper.highlight_with_escaping(query, item);
            },
            matcher: function (item) {
                var query = $.trim(this.query);
                if (query === '') {
                    return false;
                }
                // Case-insensitive.
                return (item.toLowerCase().indexOf(query.toLowerCase()) !== -1);
            },
            updater: function (item) {
                return typeahead_helper.private_message_mapped[item].email;
            }
        });
    });

    // Change the down arrow to an up arrow on expansion, and back to a down
    // arrow on collapse.
    // FIXME: If there's a way, it may be better to do this in pure CSS.
    $("#subscriptions_table").on("show", ".subscription_settings", function (e) {
        var sub_arrow = $(e.target).closest('.subscription_row').find('.sub_arrow i');
        sub_arrow.removeClass('icon-vector-chevron-down');
        sub_arrow.addClass('icon-vector-chevron-up');
    });
    $("#subscriptions_table").on("hide", ".subscription_settings", function (e) {
        var sub_arrow = $(e.target).closest('.subscription_row').find('.sub_arrow i');
        sub_arrow.removeClass('icon-vector-chevron-up');
        sub_arrow.addClass('icon-vector-chevron-down');
    });
});

function focus_on_narrowed_stream() {
    var stream_name = narrow.stream();
    if (stream_name === undefined) {
        return;
    }
    var sub = stream_data.get_sub(stream_name);
    if (sub !== undefined) {
        // This stream is in the list, so focus on it.
        $('html, body').animate({
            scrollTop: settings_for_sub(sub).offset().top
        });
    } else {
        // This stream doesn't exist, so prep for creating it.
        $("#create_stream_name").val(stream_name);
    }
}

exports.show_and_focus_on_narrow = function () {
    $("#gear-menu a[href='#subscriptions']").one('shown',
                                                 focus_on_narrowed_stream);
    ui.change_tab_to("#subscriptions");
};

return exports;

}());
if (typeof module !== 'undefined') {
    module.exports = subs;
}
