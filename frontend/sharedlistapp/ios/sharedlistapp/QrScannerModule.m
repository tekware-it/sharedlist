#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(QrScannerModule, NSObject)
RCT_EXTERN_METHOD(openScanner:(NSString *)closeTitle resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
