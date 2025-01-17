// Functions available within global scope

/**
 * Get Shoptet data layer object
 *
 * @param {String} key
 * key = key of dataLayer object
 */
function getShoptetDataLayer(key) {
    if (dataLayer[0].shoptet) {
        if (key) {
            return dataLayer[0].shoptet[key];
        } else {
            return dataLayer[0].shoptet;
        }
    }
    return undefined;
}

/**
 * Get list of all products contained in page
 *
 * This function does not accept any arguments.
 */
function getShoptetProductsList() {
    return shoptet.tracking.productsList;
}

(function(shoptet) {
    function getFormAction(formAction) {
        if (formAction === shoptet.config.addToCartUrl) {
            return shoptet.config.addToCartUrl;
        } else if (formAction === shoptet.config.removeFromCartUrl) {
            return shoptet.config.removeFromCartUrl;
        } else if (formAction === shoptet.config.updateCartUrl) {
            return shoptet.config.updateCartUrl;
        } else if (formAction === shoptet.config.addDiscountCouponUrl) {
            return shoptet.config.addDiscountCouponUrl;
        } else if (formAction === shoptet.config.setSelectedGiftUrl) {
            return shoptet.config.setSelectedGiftUrl;
        }

        return false;
    }

    function resolveUpdateAction(data) {
        if (data.amount < data.previousAmount) {
            return 'remove';
        } else if (data.amount > 0) {
            return 'add';
        }
        return false;
    }

    function resolveAffectedPriceId(response) {
        var FEdataLayer = getShoptetDataLayer('cart') || [];
        var BEdataLayer = response.getFromPayload('cartItems') || [];
        // Change of the amount
        if (FEdataLayer.length === BEdataLayer.length) {
            for (var i=0;i<FEdataLayer.length;i++) {
                if (FEdataLayer[i].quantity !== BEdataLayer[i].quantity) {
                    return FEdataLayer[i].priceId;
                }
            }
        } 
        // Product added
        if (BEdataLayer.length > FEdataLayer.length) {
            for (var i=0;i<BEdataLayer.length;i++) {
                if (!FEdataLayer[i] || FEdataLayer[i].code !== BEdataLayer[i].code) {
                    return BEdataLayer[i].priceId;
                }
            }
        }
        // Product removed
        if (FEdataLayer.length > BEdataLayer.length) {
            for (var i=0;i<FEdataLayer.length;i++) {
                if (!BEdataLayer[i] || FEdataLayer[i].code !== BEdataLayer[i].code) {
                    return FEdataLayer[i].priceId;
                }
            }
        }
        return false;
    }

    function resolveAmount(formAction, data) {
        var amount = data.amount;
        if (shoptet.tracking.getFormAction(formAction) === shoptet.config.updateCartUrl) {
            amount = Math.abs(data.amount - data.previousAmount);
            if (amount === 0) {
                // All products deleted...
                amount = data.previousAmount;
            }
        }
        return amount;
    }

    function resolveTrackingAction(formAction, data) {
        if (formAction === shoptet.config.updateCartUrl) {
            return shoptet.tracking.resolveUpdateAction(data);
        } else if (formAction === shoptet.config.addToCartUrl) {
            return 'add';
        } else if (formAction === shoptet.config.removeFromCartUrl) {
            return 'remove';
        }
        return 'ViewContent';
    }

    function handleAction(form, response) {
        var formAction = shoptet.tracking.getFormAction(form.getAttribute('action'));
        if (!formAction) {
            return;
        }

        var priceId = resolveAffectedPriceId(response);

        shoptet.tracking.updateDataLayerCartInfo(response);

        if (priceId) {
            trackProducts(
                form,
                priceId,
                formAction,
                [
                    shoptet.tracking.trackGoogleCart,
                    shoptet.tracking.trackFacebookPixel,
                    shoptet.tracking.trackGlamiPixel,
                    shoptet.tracking.updateGoogleEcommerce
                ]
            );
        }
        shoptet.tracking.updateCartDataLayer(response);
    }

    function trackProducts(form, priceId, formAction, trackingFunctions) {
        if (typeof shoptet.tracking.productsList !== 'object') {
            return;
        }
        productData = shoptet.tracking.productsList[priceId];
        if (typeof productData !== 'object') {
            return;
        }

        var amountInput = form.querySelector('input[name=amount]'),
            amount = 1,
            previousAmount = false;

        if (amountInput) {
            amount = parseFloat(amountInput.value);
            amount = amount > 0 ? amount : 1;
            previousAmount = parseFloat(amountInput.defaultValue);
        }

        productData.amount = amount;
        productData.previousAmount = previousAmount;

        trackingFunctions.forEach(function(trackingFunction) {
            if (typeof trackingFunction === 'function') {
                trackingFunction(productData, formAction);
            }
        });
        shoptet.scripts.signalCustomEvent('ShoptetProductsTracked');
    }

    function trackFacebookPixel(fbPixelData, formAction) {
        if (typeof fbq === 'function') {
            var action = shoptet.tracking.resolveTrackingAction(formAction, fbPixelData);
            var eventName;

            var amount = shoptet.tracking.resolveAmount(formAction, fbPixelData);
            var priceValue = fbPixelData.facebookPixelVat ? fbPixelData.value : fbPixelData.valueWoVat;
            var data = {
                content_name: fbPixelData.content_name,
                content_category: fbPixelData.content_category,
                content_ids: fbPixelData.content_ids,
                content_type: 'product',
                value: parseFloat(priceValue) * amount,
                currency: fbPixelData.currency,
                eventId: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
            };

            var eventInfo = {
                eventID: data.eventId
            };

            switch (action) {
                case 'remove':
                    eventName = 'trackCustom';
                    action = 'RemoveFromCart';
                    break;
                case 'add':
                    eventName = 'track';
                    action = 'AddToCart';
                    break;
                case 'ViewContent':
                    eventName = 'track';
                    action = 'ViewContent';
                    break;
                default:
                    return;
            }

            fbq(eventName, action, data, eventInfo);
        }

        shoptet.tracking.trackFacebookPixelApi(eventName, action, data);
        shoptet.scripts.signalCustomEvent('ShoptetFacebookPixelTracked');
    }

    function trackFacebookPixelApi(eventName, action, data) {
        if (!shoptet.config.fbCAPIEnabled) {
            return;
        }

        var payload = {
            eventName: eventName,
            eventId: data.eventId,
            action: action,
            data: data
        };

        var settings = {
            url: shoptet.config.fbCAPIUrl,
            type: 'POST',
            data: {
                payload: payload
            }
        };

        if (shoptet.csrf.csrfToken !== undefined) {
            settings.data.__csrf__ = shoptet.csrf.csrfToken;
        }

        $.ajax(settings);
    }

    function trackGlamiPixel(productData, formAction) {
        if (typeof glami !== 'function') {
            return;
        }

        var trackingAction = shoptet.tracking.resolveTrackingAction(formAction, productData);

        if (trackingAction !== 'add') {
            return;
        }

        var eventName = 'track';
        var eventAction = 'AddToCart';
        var eventParams = {
            item_ids: productData.content_ids.slice(),
            value: productData.value,
            currency: productData.currency,
            consent: shoptet.consent.isAccepted(shoptet.config.cookiesConsentOptAnalytics) ? 1 : 0
        };

        glami(eventName, eventAction, eventParams);

        shoptet.scripts.signalCustomEvent('ShoptetGlamiPixelTracked');
    }

    function trackGoogleProductDetail(gaData, action) {
        if (typeof gtag === 'function') {
            gtag('event', 'view_item', {
                "send_to": "analytics",
                "items": [
                    {
                        "id": gaData.content_ids[0],
                        "name": gaData.base_name,
                        "category": gaData.content_category,
                        "brand": gaData.manufacturer,
                        "variant": gaData.variant,
                        "price": gaData.valueWoVat
                    }
                ]
            });
        }

        shoptet.scripts.signalCustomEvent('ShoptetGoogleProductDetailTracked');
    }

    function trackGoogleCart(gaData, formAction) {
        var action = shoptet.tracking.resolveTrackingAction(formAction, gaData);
        var eventName = '';

        switch (action) {
            case 'add':
                eventName = 'add_to_cart';
                break;
            case 'remove':
                eventName = 'remove_from_cart';
                break;
            default:
                return;
        }

        var amount = shoptet.tracking.resolveAmount(formAction, gaData);

        if (typeof gtag === 'function') {
            gtag('event', eventName, {
                "send_to": "analytics",
                "items": [
                    {
                        "id": gaData.content_ids[0],
                        "name": gaData.base_name,
                        "brand": gaData.manufacturer,
                        "category": gaData.content_category,
                        "variant": gaData.variant,
                        "quantity": amount,
                        "price": gaData.valueWoVat
                    }
                ]
            });
        }

        shoptet.scripts.signalCustomEvent('ShoptetGoogleCartTracked');
    }

    function updateGoogleEcommerce(data, formAction) {
        if (typeof dataLayer === 'object') {
            var action = shoptet.tracking.resolveTrackingAction(formAction, data);
            var amount = shoptet.tracking.resolveAmount(formAction, data);
            var itemWasHandled = false;

            var GTMshoppingCart = {
                'ecommerce': {
                  'currencyCode': data.currency,
                }
            }
            // Populate only notnull values productFieldObject
            productData = {};
            productData.id = data.content_ids[0];
            productData.name = data.base_name;
            productData.brand = data.manufacturer;
            productData.category = data.content_category;
            productData.variant = data.variant;
            productData.price = data.value;
            productData.quantity = data.amount;
            for (var key in productData) {
                if (productData[key] === null) {
                    delete productData[key];
                }
            }

            // check if item is already in cart
            dataLayer[0].shoptet.cart.forEach(function(el, i) {
                if (itemWasHandled) {
                    return;
                }
                if (el.code === data.content_ids[0]) {
                    switch (action) {
                        case 'add':
                            el.quantity = el.quantity + amount;
                            itemWasHandled = true;
                            break;
                        case 'remove':
                            if (el.quantity - amount > 0) {
                                el.quantity = el.quantity - amount;
                            } else {
                                dataLayer[0].shoptet.cart.splice(i, 1);
                            }
                            GTMshoppingCart.event = 'removeFromCart';
                            GTMshoppingCart.ecommerce.remove = [];
                            GTMshoppingCart.ecommerce.remove.push(productData);
                            itemWasHandled = true;
                            break;
                    }
                }
            });

            // Not removing product, add an item
            if (typeof GTMshoppingCart.event === 'undefined') {
                GTMshoppingCart.event = 'addToCart';
                GTMshoppingCart.ecommerce.add = [];
                GTMshoppingCart.ecommerce.add.push(productData);
            }

            dataLayer.push(GTMshoppingCart);
        }
    }

    function handlePromoClick(el) {
        var promo = shoptet.tracking.bannersList[el.dataset.ecPromoId];

        if (promo && typeof gtag === 'function') {
            gtag('event', 'select_content', {
                "send_to": "analytics",
                "promotions": [
                    {
                        "id": promo.id,
                        "name": promo.name
                    }
                ]
            });
        }
    }

    function trackProductsFromPayload(requestedDocument) {
        var trackingScript = requestedDocument.getElementById('trackingScript');
        if (trackingScript) {
            var trackingProducts = JSON.parse(
                trackingScript.getAttribute('data-products')
            );
            shoptet.tracking.productsList = $.extend(trackingProducts.products, shoptet.tracking.productsList);
        }
    }

    function updateCartDataLayer(response) {
        dataLayer[0].shoptet.cart = response.getFromPayload('cartItems') || [];
        shoptet.scripts.signalCustomEvent('ShoptetDataLayerUpdated');
    }

    function updateDataLayerCartInfo(response) {
        if (typeof dataLayer === 'object') {
            var leftToFreeShipping = response.getFromPayload('leftToFreeShipping');

            if(leftToFreeShipping !== null) {
                dataLayer[0].shoptet.cartInfo.leftToFreeShipping = leftToFreeShipping;
            }
            var freeShipping = response.getFromPayload('freeShipping');
            if(freeShipping !== null) {
                dataLayer[0].shoptet.cartInfo.freeShipping = freeShipping;
            }
            var discountCoupon = response.getFromPayload('discountCoupon');
            if(discountCoupon !== null) {
                dataLayer[0].shoptet.cartInfo.discountCoupon = discountCoupon;
            }

            var leftToFreeGift = response.getFromPayload('leftToFreeGift');
            if(leftToFreeGift !== null) {
                dataLayer[0].shoptet.cartInfo.leftToFreeGift = leftToFreeGift;
            }
            var freeGift = response.getFromPayload('freeGift');
            if(freeGift !== null) {
                dataLayer[0].shoptet.cartInfo.freeGift = freeGift;
            }
            var trackingContainer = response.getFromPayload('trackingContainer');
            if(trackingContainer !== null) {
                trackingContainer = JSON.parse(trackingContainer);
                shoptet.tracking.productsList = $.extend(trackingContainer.products, shoptet.tracking.productsList);
            }
        }
    }

    document.addEventListener("DOMContentLoaded", function() {
        var i;
        var imageBanners = document.querySelectorAll('a[data-ec-promo-id]');
        for (i = 0; i < imageBanners.length; i++) {
            (function(i) {
                imageBanners[i].addEventListener('click', function() {
                    shoptet.tracking.handlePromoClick(imageBanners[i]);
                });
            })(i);
        }
        var textBanners = document.querySelectorAll('span[data-ec-promo-id]');
        for (i = 0; i < textBanners.length; i++) {
            (function(i) {
                var linksInTextBanner = textBanners[i].querySelectorAll('a');
                (function(links, banner) {
                    for (var i = 0; i < links.length; i++) {
                        links[i].addEventListener('click', function() {
                            shoptet.tracking.handlePromoClick(banner);
                        });
                    }
                })(linksInTextBanner, textBanners[i]);
            })(i);
        }
    });

    shoptet.tracking = shoptet.tracking || {};
    shoptet.scripts.libs.tracking.forEach(function(fnName) {
        var fn = eval(fnName);
        shoptet.scripts.registerFunction(fn, 'tracking');
    });

})(shoptet);
