"""Generate a dependency-free Xcode project for the iPhone and Watch companion."""
from pathlib import Path
import hashlib,plistlib
root=Path(__file__).resolve().parent
objects={}
def ident(name):return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def put(name,body):objects[ident(name)]=body;return ident(name)
def group(name,children,path=''):
 return put(name,'isa = PBXGroup; children = ('+','.join(children)+'); sourceTree = "<group>";'+('path = "'+path+'";' if path else ''))
def ref(path,kind):return put('ref:'+path,'isa = PBXFileReference; lastKnownFileType = '+kind+'; path = "'+path+'"; sourceTree = "<group>";')
def config(name,settings):
 return put('config:'+name,'isa = XCBuildConfiguration; name = '+name.split(':')[-1]+'; buildSettings = {'+''.join(k+' = '+v+';' for k,v in settings.items())+'};')
def configlist(name,settings):
 ids=[config(name+':'+mode,{**settings,**({'SWIFT_OPTIMIZATION_LEVEL':'"-Onone"','DEBUG_INFORMATION_FORMAT':'dwarf'} if mode=='Debug' else {'SWIFT_OPTIMIZATION_LEVEL':'"-O"','DEBUG_INFORMATION_FORMAT':'"dwarf-with-dsym"'})}) for mode in ['Debug','Release']]
 return put('configs:'+name,'isa = XCConfigurationList; buildConfigurations = ('+','.join(ids)+'); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
shared=ref('../CaptureCore/Sources/CaptureCore/CaptureProtocol.swift','sourcecode.swift')
products=[];targets=[];targetids={name:ident('target:'+name) for name in ['EppCamera','EppCameraWatch']}
productids={name:ident('product:'+name) for name in targetids}
groups=[]
for name,folder,files,sdk,family,minimum in [
 ('EppCamera','iPhone',['EppCameraApp.swift','CameraBridge.swift','CameraController.swift'],'iphoneos','1','IPHONEOS_DEPLOYMENT_TARGET'),
 ('EppCameraWatch','Watch',['EppCameraWatchApp.swift'],'watchos','4','WATCHOS_DEPLOYMENT_TARGET')]:
 refs=[ref(folder+'/'+f,'sourcecode.swift') for f in files]+[shared]
 groups.extend(refs[:-1])
 builds=[put('build:'+name+':'+r,'isa = PBXBuildFile; fileRef = '+r+';') for r in refs]
 sources=put('sources:'+name,'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ('+','.join(builds)+'); runOnlyForDeploymentPostprocessing = 0;')
 frameworks=put('frameworks:'+name,'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
 phases=[sources,frameworks];dependencies=[]
 if name=='EppCamera':
  proxy=put('watch-proxy','isa = PBXContainerItemProxy; containerPortal = '+ident('project')+'; proxyType = 1; remoteGlobalIDString = '+targetids['EppCameraWatch']+'; remoteInfo = EppCameraWatch;')
  dependency=put('watch-dependency','isa = PBXTargetDependency; target = '+targetids['EppCameraWatch']+'; targetProxy = '+proxy+';');dependencies.append(dependency)
  embed=put('watch-embed','isa = PBXBuildFile; fileRef = '+productids['EppCameraWatch']+'; settings = {ATTRIBUTES = (RemoveHeadersOnCopy,);};')
  phases.append(put('watch-copy','isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = "$(CONTENTS_FOLDER_PATH)/Watch"; dstSubfolderSpec = 16; files = ('+embed+'); name = "Embed Watch Content"; runOnlyForDeploymentPostprocessing = 0;'))
 product=put('product:'+name,'isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = '+name+'.app; sourceTree = BUILT_PRODUCTS_DIR;');products.append(product)
 settings={'PRODUCT_BUNDLE_IDENTIFIER':'nl.epp.app.camera'+('.watchapp' if name.endswith('Watch') else ''),'PRODUCT_NAME':'"$(TARGET_NAME)"','SDKROOT':sdk,'TARGETED_DEVICE_FAMILY':'"'+family+'"',minimum:'"'+('10.0' if sdk=='watchos' else '17.0')+'"','SWIFT_VERSION':'5.0','CODE_SIGN_STYLE':'Automatic','GENERATE_INFOPLIST_FILE':'NO','INFOPLIST_FILE':'"'+folder+'/Info.plist"','CURRENT_PROJECT_VERSION':'1','MARKETING_VERSION':'1.0','ENABLE_USER_SCRIPT_SANDBOXING':'YES','SWIFT_EMIT_LOC_STRINGS':'YES','SUPPORTED_PLATFORMS':'"'+('watchos watchsimulator' if sdk=='watchos' else 'iphoneos iphonesimulator')+'"'}
 if sdk=='watchos':settings['SKIP_INSTALL']='YES'
 configs=configlist(name,settings)
 target=put('target:'+name,'isa = PBXNativeTarget; buildConfigurationList = '+configs+'; buildPhases = ('+','.join(phases)+'); buildRules = (); dependencies = ('+','.join(dependencies)+'); name = '+name+'; productName = '+name+'; productReference = '+product+'; productType = "com.apple.product-type.application";');targets.append(target)
productgroup=group('products',products)
maingroup=group('main',groups+[shared,productgroup])
configs=configlist('project',{'CLANG_ENABLE_MODULES':'YES','CLANG_ENABLE_OBJC_ARC':'YES','GCC_C_LANGUAGE_STANDARD':'gnu17','SWIFT_VERSION':'5.0'})
project=put('project','isa = PBXProject; attributes = {BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 1600; TargetAttributes = {'+''.join(t+' = {CreatedOnToolsVersion = 16.0;};' for t in targets)+'};}; buildConfigurationList = '+configs+'; compatibilityVersion = "Xcode 14.0"; developmentRegion = nl; hasScannedForEncodings = 0; knownRegions = (nl,en,Base); mainGroup = '+maingroup+'; productRefGroup = '+productgroup+'; projectDirPath = ""; projectRoot = ""; targets = ('+','.join(targets)+');')
p=root/'EppCamera.xcodeproj/project.pbxproj';p.parent.mkdir(parents=True,exist_ok=True)
p.write_text('// !$*UTF8*$!\n{archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+''.join(k+' = {'+body+'};\n' for k,body in objects.items())+'}; rootObject = '+project+';}\n')
for name in targetids:
 scheme='''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="ID" BuildableName="NAME.app" BlueprintName="NAME" ReferencedContainer="container:EppCamera.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="NO"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="ID" BuildableName="NAME.app" BlueprintName="NAME" ReferencedContainer="container:EppCamera.xcodeproj"/></BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>
'''.replace('ID',targetids[name]).replace('NAME',name)
 path=root/'EppCamera.xcodeproj/xcshareddata/xcschemes'/f'{name}.xcscheme';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(scheme)
for folder,name,extra in [
 ('iPhone','EPP Camera',{'NSCameraUsageDescription':'Maak op jouw verzoek kaartfoto’s voor de puntenteller.','NSPhotoLibraryUsageDescription':'Selecteer een bestaande kaartfoto voor EPP.','UILaunchScreen':{},'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait'],'LSRequiresIPhoneOS':True}),
 ('Watch','EPP Camera',{'WKApplication':True,'WKCompanionAppBundleIdentifier':'nl.epp.app.camera','WKWatchOnly':False,'WKRunsIndependentlyOfCompanionApp':False})]:
 data={'CFBundleDisplayName':name,'CFBundleExecutable':'$(EXECUTABLE_NAME)','CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleInfoDictionaryVersion':'6.0','CFBundleName':'$(PRODUCT_NAME)','CFBundlePackageType':'APPL','CFBundleShortVersionString':'$(MARKETING_VERSION)','CFBundleVersion':'$(CURRENT_PROJECT_VERSION)',**extra}
 (root/folder/'Info.plist').write_bytes(plistlib.dumps(data))
print('Generated iPhone and watchOS Xcode targets.')
