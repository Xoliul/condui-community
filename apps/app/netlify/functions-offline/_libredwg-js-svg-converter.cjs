var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../node_modules/@mlightcad/libredwg-web/lib/svg/svgConverter.js
var svgConverter_exports = {};
__export(svgConverter_exports, {
  SvgConverter: () => SvgConverter,
  Box2D: () => Box2D,
  interpolatePolyline: () => interpolatePolyline
});
module.exports = __toCommonJS(svgConverter_exports);

// ../../node_modules/@mlightcad/libredwg-web/lib/converter/utils.js
var MODEL_SPACE = "*MODEL_SPACE";
var isModelSpace = (name) => {
  return name && name.toUpperCase() == MODEL_SPACE;
};

// ../../node_modules/@mlightcad/libredwg-web/lib/database/codepage.js
var DwgCodePage;
(function(DwgCodePage2) {
  DwgCodePage2[DwgCodePage2["CP_UTF8"] = 0] = "CP_UTF8";
  DwgCodePage2[DwgCodePage2["CP_US_ASCII"] = 1] = "CP_US_ASCII";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_1"] = 2] = "CP_ISO_8859_1";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_2"] = 3] = "CP_ISO_8859_2";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_3"] = 4] = "CP_ISO_8859_3";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_4"] = 5] = "CP_ISO_8859_4";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_5"] = 6] = "CP_ISO_8859_5";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_6"] = 7] = "CP_ISO_8859_6";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_7"] = 8] = "CP_ISO_8859_7";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_8"] = 9] = "CP_ISO_8859_8";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_9"] = 10] = "CP_ISO_8859_9";
  DwgCodePage2[DwgCodePage2["CP_CP437"] = 11] = "CP_CP437";
  DwgCodePage2[DwgCodePage2["CP_CP850"] = 12] = "CP_CP850";
  DwgCodePage2[DwgCodePage2["CP_CP852"] = 13] = "CP_CP852";
  DwgCodePage2[DwgCodePage2["CP_CP855"] = 14] = "CP_CP855";
  DwgCodePage2[DwgCodePage2["CP_CP857"] = 15] = "CP_CP857";
  DwgCodePage2[DwgCodePage2["CP_CP860"] = 16] = "CP_CP860";
  DwgCodePage2[DwgCodePage2["CP_CP861"] = 17] = "CP_CP861";
  DwgCodePage2[DwgCodePage2["CP_CP863"] = 18] = "CP_CP863";
  DwgCodePage2[DwgCodePage2["CP_CP864"] = 19] = "CP_CP864";
  DwgCodePage2[DwgCodePage2["CP_CP865"] = 20] = "CP_CP865";
  DwgCodePage2[DwgCodePage2["CP_CP869"] = 21] = "CP_CP869";
  DwgCodePage2[DwgCodePage2["CP_CP932"] = 22] = "CP_CP932";
  DwgCodePage2[DwgCodePage2["CP_MACINTOSH"] = 23] = "CP_MACINTOSH";
  DwgCodePage2[DwgCodePage2["CP_BIG5"] = 24] = "CP_BIG5";
  DwgCodePage2[DwgCodePage2["CP_CP949"] = 25] = "CP_CP949";
  DwgCodePage2[DwgCodePage2["CP_JOHAB"] = 26] = "CP_JOHAB";
  DwgCodePage2[DwgCodePage2["CP_CP866"] = 27] = "CP_CP866";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1250"] = 28] = "CP_ANSI_1250";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1251"] = 29] = "CP_ANSI_1251";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1252"] = 30] = "CP_ANSI_1252";
  DwgCodePage2[DwgCodePage2["CP_GB2312"] = 31] = "CP_GB2312";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1253"] = 32] = "CP_ANSI_1253";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1254"] = 33] = "CP_ANSI_1254";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1255"] = 34] = "CP_ANSI_1255";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1256"] = 35] = "CP_ANSI_1256";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1257"] = 36] = "CP_ANSI_1257";
  DwgCodePage2[DwgCodePage2["CP_ANSI_874"] = 37] = "CP_ANSI_874";
  DwgCodePage2[DwgCodePage2["CP_ANSI_932"] = 38] = "CP_ANSI_932";
  DwgCodePage2[DwgCodePage2["CP_ANSI_936"] = 39] = "CP_ANSI_936";
  DwgCodePage2[DwgCodePage2["CP_ANSI_949"] = 40] = "CP_ANSI_949";
  DwgCodePage2[DwgCodePage2["CP_ANSI_950"] = 41] = "CP_ANSI_950";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1361"] = 42] = "CP_ANSI_1361";
  DwgCodePage2[DwgCodePage2["CP_UTF16"] = 43] = "CP_UTF16";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1258"] = 44] = "CP_ANSI_1258";
  DwgCodePage2[DwgCodePage2["CP_UNDEFINED"] = 255] = "CP_UNDEFINED";
})(DwgCodePage || (DwgCodePage = {}));

// ../../node_modules/@mlightcad/libredwg-web/lib/database/entities/dimension.js
var DwgDimensionType;
(function(DwgDimensionType2) {
  DwgDimensionType2[DwgDimensionType2["Rotated"] = 0] = "Rotated";
  DwgDimensionType2[DwgDimensionType2["Aligned"] = 1] = "Aligned";
  DwgDimensionType2[DwgDimensionType2["Angular"] = 2] = "Angular";
  DwgDimensionType2[DwgDimensionType2["Diameter"] = 3] = "Diameter";
  DwgDimensionType2[DwgDimensionType2["Radius"] = 4] = "Radius";
  DwgDimensionType2[DwgDimensionType2["Angular3Point"] = 5] = "Angular3Point";
  DwgDimensionType2[DwgDimensionType2["Ordinate"] = 6] = "Ordinate";
  DwgDimensionType2[DwgDimensionType2["ReferenceIsExclusive"] = 32] = "ReferenceIsExclusive";
  DwgDimensionType2[DwgDimensionType2["IsOrdinateXTypeFlag"] = 64] = "IsOrdinateXTypeFlag";
  DwgDimensionType2[DwgDimensionType2["IsCustomTextPositionFlag"] = 128] = "IsCustomTextPositionFlag";
})(DwgDimensionType || (DwgDimensionType = {}));
var DwgAttachmentPoint;
(function(DwgAttachmentPoint2) {
  DwgAttachmentPoint2[DwgAttachmentPoint2["TopLeft"] = 1] = "TopLeft";
  DwgAttachmentPoint2[DwgAttachmentPoint2["TopCenter"] = 2] = "TopCenter";
  DwgAttachmentPoint2[DwgAttachmentPoint2["TopRight"] = 3] = "TopRight";
  DwgAttachmentPoint2[DwgAttachmentPoint2["MiddleLeft"] = 4] = "MiddleLeft";
  DwgAttachmentPoint2[DwgAttachmentPoint2["MiddleCenter"] = 5] = "MiddleCenter";
  DwgAttachmentPoint2[DwgAttachmentPoint2["MiddleRight"] = 6] = "MiddleRight";
  DwgAttachmentPoint2[DwgAttachmentPoint2["BottomLeft"] = 7] = "BottomLeft";
  DwgAttachmentPoint2[DwgAttachmentPoint2["BottomCenter"] = 8] = "BottomCenter";
  DwgAttachmentPoint2[DwgAttachmentPoint2["BottomRight"] = 9] = "BottomRight";
})(DwgAttachmentPoint || (DwgAttachmentPoint = {}));
var DwgDimensionTextLineSpacing;
(function(DwgDimensionTextLineSpacing2) {
  DwgDimensionTextLineSpacing2[DwgDimensionTextLineSpacing2["AtLeast"] = 1] = "AtLeast";
  DwgDimensionTextLineSpacing2[DwgDimensionTextLineSpacing2["Exact"] = 2] = "Exact";
})(DwgDimensionTextLineSpacing || (DwgDimensionTextLineSpacing = {}));
var DwgDimensionTextVertical;
(function(DwgDimensionTextVertical2) {
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["Center"] = 0] = "Center";
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["Above"] = 1] = "Above";
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["Outside"] = 2] = "Outside";
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["JIS"] = 3] = "JIS";
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["Below"] = 4] = "Below";
})(DwgDimensionTextVertical || (DwgDimensionTextVertical = {}));
var DwgDimensionZeroSuppression;
(function(DwgDimensionZeroSuppression2) {
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["Feet"] = 0] = "Feet";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["None"] = 1] = "None";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["Inch"] = 2] = "Inch";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["FeetAndInch"] = 3] = "FeetAndInch";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["Leading"] = 4] = "Leading";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["Trailing"] = 8] = "Trailing";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["LeadingAndTrailing"] = 12] = "LeadingAndTrailing";
})(DwgDimensionZeroSuppression || (DwgDimensionZeroSuppression = {}));
var DwgDimensionZeroSuppressionAngular;
(function(DwgDimensionZeroSuppressionAngular2) {
  DwgDimensionZeroSuppressionAngular2[DwgDimensionZeroSuppressionAngular2["None"] = 0] = "None";
  DwgDimensionZeroSuppressionAngular2[DwgDimensionZeroSuppressionAngular2["Leading"] = 1] = "Leading";
  DwgDimensionZeroSuppressionAngular2[DwgDimensionZeroSuppressionAngular2["Trailing"] = 2] = "Trailing";
  DwgDimensionZeroSuppressionAngular2[DwgDimensionZeroSuppressionAngular2["LeadingAndTrailing"] = 3] = "LeadingAndTrailing";
})(DwgDimensionZeroSuppressionAngular || (DwgDimensionZeroSuppressionAngular = {}));
var DwgDimensionTextHorizontal;
(function(DwgDimensionTextHorizontal2) {
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["Center"] = 0] = "Center";
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["Left"] = 1] = "Left";
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["Right"] = 2] = "Right";
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["OverFirst"] = 3] = "OverFirst";
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["OverSecond"] = 4] = "OverSecond";
})(DwgDimensionTextHorizontal || (DwgDimensionTextHorizontal = {}));
var DwgDimensionToleranceTextVertical;
(function(DwgDimensionToleranceTextVertical2) {
  DwgDimensionToleranceTextVertical2[DwgDimensionToleranceTextVertical2["Bottom"] = 0] = "Bottom";
  DwgDimensionToleranceTextVertical2[DwgDimensionToleranceTextVertical2["Center"] = 1] = "Center";
  DwgDimensionToleranceTextVertical2[DwgDimensionToleranceTextVertical2["Top"] = 2] = "Top";
})(DwgDimensionToleranceTextVertical || (DwgDimensionToleranceTextVertical = {}));

// ../../node_modules/@mlightcad/libredwg-web/lib/database/entities/hatch.js
var DwgHatchSolidFill;
(function(DwgHatchSolidFill2) {
  DwgHatchSolidFill2[DwgHatchSolidFill2["PatternFill"] = 0] = "PatternFill";
  DwgHatchSolidFill2[DwgHatchSolidFill2["SolidFill"] = 1] = "SolidFill";
})(DwgHatchSolidFill || (DwgHatchSolidFill = {}));
var DwgHatchAssociativity;
(function(DwgHatchAssociativity2) {
  DwgHatchAssociativity2[DwgHatchAssociativity2["NonAssociative"] = 0] = "NonAssociative";
  DwgHatchAssociativity2[DwgHatchAssociativity2["Associative"] = 1] = "Associative";
})(DwgHatchAssociativity || (DwgHatchAssociativity = {}));
var DwgHatchStyle;
(function(DwgHatchStyle2) {
  DwgHatchStyle2[DwgHatchStyle2["Normal"] = 0] = "Normal";
  DwgHatchStyle2[DwgHatchStyle2["Outer"] = 1] = "Outer";
  DwgHatchStyle2[DwgHatchStyle2["Ignore"] = 2] = "Ignore";
})(DwgHatchStyle || (DwgHatchStyle = {}));
var DwgHatchPatternType;
(function(DwgHatchPatternType2) {
  DwgHatchPatternType2[DwgHatchPatternType2["UserDefined"] = 0] = "UserDefined";
  DwgHatchPatternType2[DwgHatchPatternType2["Predefined"] = 1] = "Predefined";
  DwgHatchPatternType2[DwgHatchPatternType2["Custom"] = 2] = "Custom";
})(DwgHatchPatternType || (DwgHatchPatternType = {}));
var DwgHatchBoundaryAnnotation;
(function(DwgHatchBoundaryAnnotation2) {
  DwgHatchBoundaryAnnotation2[DwgHatchBoundaryAnnotation2["NotAnnotated"] = 0] = "NotAnnotated";
  DwgHatchBoundaryAnnotation2[DwgHatchBoundaryAnnotation2["Annotated"] = 1] = "Annotated";
})(DwgHatchBoundaryAnnotation || (DwgHatchBoundaryAnnotation = {}));
var DwgHatchGradientFlag;
(function(DwgHatchGradientFlag2) {
  DwgHatchGradientFlag2[DwgHatchGradientFlag2["Solid"] = 0] = "Solid";
  DwgHatchGradientFlag2[DwgHatchGradientFlag2["Gradient"] = 1] = "Gradient";
})(DwgHatchGradientFlag || (DwgHatchGradientFlag = {}));
var DwgHatchGradientColorFlag;
(function(DwgHatchGradientColorFlag2) {
  DwgHatchGradientColorFlag2[DwgHatchGradientColorFlag2["TwoColor"] = 0] = "TwoColor";
  DwgHatchGradientColorFlag2[DwgHatchGradientColorFlag2["OneColor"] = 1] = "OneColor";
})(DwgHatchGradientColorFlag || (DwgHatchGradientColorFlag = {}));
var DwgBoundaryPathTypeFlag;
(function(DwgBoundaryPathTypeFlag2) {
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Default"] = 0] = "Default";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["External"] = 1] = "External";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Polyline"] = 2] = "Polyline";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Derived"] = 4] = "Derived";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Textbox"] = 8] = "Textbox";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Outermost"] = 16] = "Outermost";
})(DwgBoundaryPathTypeFlag || (DwgBoundaryPathTypeFlag = {}));
var DwgBoundaryPathEdgeType;
(function(DwgBoundaryPathEdgeType2) {
  DwgBoundaryPathEdgeType2[DwgBoundaryPathEdgeType2["Line"] = 1] = "Line";
  DwgBoundaryPathEdgeType2[DwgBoundaryPathEdgeType2["Circular"] = 2] = "Circular";
  DwgBoundaryPathEdgeType2[DwgBoundaryPathEdgeType2["Elliptic"] = 3] = "Elliptic";
  DwgBoundaryPathEdgeType2[DwgBoundaryPathEdgeType2["Spline"] = 4] = "Spline";
})(DwgBoundaryPathEdgeType || (DwgBoundaryPathEdgeType = {}));

// ../../node_modules/@mlightcad/libredwg-web/lib/database/entities/polyline.js
var DwgPolylineFlag;
(function(DwgPolylineFlag2) {
  DwgPolylineFlag2[DwgPolylineFlag2["CLOSED_POLYLINE"] = 1] = "CLOSED_POLYLINE";
  DwgPolylineFlag2[DwgPolylineFlag2["CURVE_FIT"] = 2] = "CURVE_FIT";
  DwgPolylineFlag2[DwgPolylineFlag2["SPLINE_FIT"] = 4] = "SPLINE_FIT";
  DwgPolylineFlag2[DwgPolylineFlag2["POLYLINE_3D"] = 8] = "POLYLINE_3D";
  DwgPolylineFlag2[DwgPolylineFlag2["POLYGON_3D"] = 16] = "POLYGON_3D";
  DwgPolylineFlag2[DwgPolylineFlag2["CLOSED_POLYGON"] = 32] = "CLOSED_POLYGON";
  DwgPolylineFlag2[DwgPolylineFlag2["POLYFACE"] = 64] = "POLYFACE";
  DwgPolylineFlag2[DwgPolylineFlag2["CONTINUOUS"] = 128] = "CONTINUOUS";
})(DwgPolylineFlag || (DwgPolylineFlag = {}));
var DwgSmoothType;
(function(DwgSmoothType2) {
  DwgSmoothType2[DwgSmoothType2["NONE"] = 0] = "NONE";
  DwgSmoothType2[DwgSmoothType2["QUADRATIC"] = 5] = "QUADRATIC";
  DwgSmoothType2[DwgSmoothType2["CUBIC"] = 6] = "CUBIC";
  DwgSmoothType2[DwgSmoothType2["BEZIER"] = 8] = "BEZIER";
})(DwgSmoothType || (DwgSmoothType = {}));

// ../../node_modules/@mlightcad/libredwg-web/lib/database/entities/text.js
var DwgTextGenerationFlag;
(function(DwgTextGenerationFlag2) {
  DwgTextGenerationFlag2[DwgTextGenerationFlag2["NONE"] = 0] = "NONE";
  DwgTextGenerationFlag2[DwgTextGenerationFlag2["MIRRORED_X"] = 2] = "MIRRORED_X";
  DwgTextGenerationFlag2[DwgTextGenerationFlag2["MIRRORED_Y"] = 4] = "MIRRORED_Y";
})(DwgTextGenerationFlag || (DwgTextGenerationFlag = {}));
var DwgTextHorizontalAlign;
(function(DwgTextHorizontalAlign2) {
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["LEFT"] = 0] = "LEFT";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["CENTER"] = 1] = "CENTER";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["RIGHT"] = 2] = "RIGHT";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["ALIGNED"] = 3] = "ALIGNED";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["MIDDLE"] = 4] = "MIDDLE";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["FIT"] = 5] = "FIT";
})(DwgTextHorizontalAlign || (DwgTextHorizontalAlign = {}));
var DwgTextVerticalAlign;
(function(DwgTextVerticalAlign2) {
  DwgTextVerticalAlign2[DwgTextVerticalAlign2["BASELINE"] = 0] = "BASELINE";
  DwgTextVerticalAlign2[DwgTextVerticalAlign2["BOTTOM"] = 1] = "BOTTOM";
  DwgTextVerticalAlign2[DwgTextVerticalAlign2["MIDDLE"] = 2] = "MIDDLE";
  DwgTextVerticalAlign2[DwgTextVerticalAlign2["TOP"] = 3] = "TOP";
})(DwgTextVerticalAlign || (DwgTextVerticalAlign = {}));

// ../../node_modules/@mlightcad/libredwg-web/lib/database/header/variables.js
var HEADER_VARIABLES = Object.freeze([
  "ACADMAINTVER",
  "ACADVER",
  "ANGBASE",
  "ANGDIR",
  "ATTMODE",
  "AUNITS",
  "AUPREC",
  "CECOLOR",
  "CELTSCALE",
  "CELTYPE",
  "CELWEIGHT",
  "CEPSNID",
  "CEPSNTYPE",
  "CHAMFERA",
  "CHAMFERB",
  "CHAMFERC",
  "CHAMFERD",
  "CLAYER",
  "CMLJUST",
  "CMLSCALE",
  "CMLSTYLE",
  "CSHADOW",
  "DIMADEC",
  "DIMALT",
  "DIMALTD",
  "DIMALTF",
  "DIMALTRND",
  "DIMALTTD",
  "DIMALTTZ",
  "DIMALTU",
  "DIMALTZ",
  "DIMAPOST",
  "DIMASO",
  "DIMASSOC",
  "DIMASZ",
  "DIMATFIT",
  "DIMAUNIT",
  "DIMAZIN",
  "DIMBLK",
  "DIMBLK1",
  "DIMBLK2",
  "DIMCEN",
  "DIMCLRD",
  "DIMCLRE",
  "DIMCLRT",
  "DIMDEC",
  "DIMDLE",
  "DIMDLI",
  "DIMDSEP",
  "DIMEXE",
  "DIMEXO",
  "DIMFAC",
  "DIMGAP",
  "DIMJUST",
  "DIMLDRBLK",
  "DIMLFAC",
  "DIMLIM",
  "DIMLUNIT",
  "DIMLWD",
  "DIMLWE",
  "DIMPOST",
  "DIMRND",
  "DIMSAH",
  "DIMSCALE",
  "DIMSD1",
  "DIMSD2",
  "DIMSE1",
  "DIMSE2",
  "DIMSHO",
  "DIMSOXD",
  "DIMSTYLE",
  "DIMTAD",
  "DIMTDEC",
  "DIMTFAC",
  "DIMTIH",
  "DIMTIX",
  "DIMTM",
  "DIMTMOVE",
  "DIMTOFL",
  "DIMTOH",
  "DIMTOL",
  "DIMTOLJ",
  "DIMTP",
  "DIMTSZ",
  "DIMTVP",
  "DIMTXSTY",
  "DIMTXT",
  "DIMTZIN",
  "DIMUPT",
  "DIMZIN",
  "DISPSILH",
  "DRAGVS",
  "DWGCODEPAGE",
  "ELEVATION",
  "ENDCAPS",
  "EXTMAX",
  "EXTMIN",
  "EXTNAMES",
  "FILLETRAD",
  "FILLMODE",
  "FINGERPRINTGUID",
  "HALOGAP",
  "HANDSEED",
  "HIDETEXT",
  "HYPERLINKBASE",
  "INDEXCTL",
  "INSBASE",
  "INSUNITS",
  "INTERFERECOLOR",
  "INTERFEREOBJVS",
  "INTERFEREVPVS",
  "INTERSECTIONCOLOR",
  "INTERSECTIONDISPLAY",
  "JOINSTYLE",
  "LIMCHECK",
  "LIMMAX",
  "LIMMIN",
  "LTSCALE",
  "LUNITS",
  "LUPREC",
  "LWDISPLAY",
  "MAXACTVP",
  "MEASUREMENT",
  "MENU",
  "MIRRTEXT",
  "OBSCOLOR",
  "OBSLTYPE",
  "ORTHOMODE",
  "PDMODE",
  "PDSIZE",
  "PELEVATION",
  "PEXTMAX",
  "PEXTMIN",
  "PINSBASE",
  "PLIMCHECK",
  "PLIMMAX",
  "PLIMMIN",
  "PLINEGEN",
  "PLINEWID",
  "PROJECTNAME",
  "PROXYGRAPHICS",
  "PSLTSCALE",
  "PSTYLEMODE",
  "PSVPSCALE",
  "PUCSBASE",
  "PUCSNAME",
  "PUCSORG",
  "PUCSORGBACK",
  "PUCSORGBOTTOM",
  "PUCSORGFRONT",
  "PUCSORGLEFT",
  "PUCSORGRIGHT",
  "PUCSORGTOP",
  "PUCSORTHOREF",
  "PUCSORTHOVIEW",
  "PUCSXDIR",
  "PUCSYDIR",
  "QTEXTMODE",
  "REGENMODE",
  "SHADEDGE",
  "SHADEDIF",
  "SHADOWPLANELOCATION",
  "SKETCHINC",
  "SKPOLY",
  "SORTENTS",
  "SPLINESEGS",
  "SPLINETYPE",
  "SURFTAB1",
  "SURFTAB2",
  "SURFTYPE",
  "SURFU",
  "SURFV",
  "TDCREATE",
  "TDINDWG",
  "TDUCREATE",
  "TDUPDATE",
  "TDUSRTIMER",
  "TDUUPDATE",
  "TEXTSIZE",
  "TEXTSTYLE",
  "THICKNESS",
  "TILEMODE",
  "TRACEWID",
  "TREEDEPTH",
  "UCSBASE",
  "UCSNAME",
  "UCSORG",
  "UCSORGBACK",
  "UCSORGBOTTOM",
  "UCSORGFRONT",
  "UCSORGLEFT",
  "UCSORGRIGHT",
  "UCSORGTOP",
  "UCSORTHOREF",
  "UCSORTHOVIEW",
  "UCSXDIR",
  "UCSYDIR",
  "UNITMODE",
  "USERI1",
  "USERI2",
  "USERI3",
  "USERI4",
  "USERI5",
  "USERR1",
  "USERR2",
  "USERR3",
  "USERR4",
  "USERR5",
  "USRTIMER",
  "VERSIONGUID",
  "VISRETAIN",
  "WORLDVIEW",
  "XCLIPFRAME",
  "XEDIT"
]);

// ../../node_modules/@mlightcad/libredwg-web/lib/database/objects/dictionary.js
var DwgDictionaryCloningFlags;
(function(DwgDictionaryCloningFlags2) {
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["NotApplicable"] = 0] = "NotApplicable";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["KeepExisting"] = 1] = "KeepExisting";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["UseClone"] = 2] = "UseClone";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["XrefName"] = 3] = "XrefName";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["Name"] = 4] = "Name";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["UnmangleName"] = 5] = "UnmangleName";
})(DwgDictionaryCloningFlags || (DwgDictionaryCloningFlags = {}));

// ../../node_modules/@mlightcad/libredwg-web/lib/svg/box2d.js
var Box2D = class _Box2D {
  min;
  max;
  valid;
  constructor() {
    this.min = { x: Infinity, y: Infinity };
    this.max = { x: -Infinity, y: -Infinity };
    this.valid = false;
  }
  /**
   * Expands the bounding box to include a given point.
   *
   * @param point - The point to include in the bounding box.
   * @returns This bounding box after expansion.
   */
  expandByPoint(point) {
    this.min.x = Math.min(this.min.x, point.x);
    this.min.y = Math.min(this.min.y, point.y);
    this.max.x = Math.max(this.max.x, point.x);
    this.max.y = Math.max(this.max.y, point.y);
    this.valid = true;
    return this;
  }
  /**
   * Applies a scaling and translation transformation to this bounding box.
   *
   * @param scale - The scaling factors in x and y directions.
   * @param translation - The translation offsets in x and y directions.
   * @returns This bounding box after transformation.
   */
  transform(scale, translation) {
    const corners = this.getCorners().map((p) => ({
      x: p.x * scale.x + translation.x,
      y: p.y * scale.y + translation.y
    }));
    this.reset();
    for (const pt of corners) {
      this.expandByPoint(pt);
    }
    return this;
  }
  /**
   * Applies a rotation around a specific point to this bounding box.
   *
   * @param angleInRad - The angle of rotation in radians.
   * @param point - The center of rotation.
   * @returns This bounding box after rotation.
   */
  rotate(angleInRad, point) {
    const cos = Math.cos(angleInRad);
    const sin = Math.sin(angleInRad);
    const corners = this.getCorners().map((p) => {
      const dx = p.x - point.x;
      const dy = p.y - point.y;
      return {
        x: point.x + dx * cos - dy * sin,
        y: point.y + dx * sin + dy * cos
      };
    });
    this.reset();
    for (const pt of corners) {
      this.expandByPoint(pt);
    }
    return this;
  }
  /**
   * Creates a deep copy of this bounding box.
   *
   * @returns A new instance of Box2D with the same properties.
   */
  clone() {
    const box = new _Box2D();
    box.min = { x: this.min.x, y: this.min.y };
    box.max = { x: this.max.x, y: this.max.y };
    box.valid = this.valid;
    return box;
  }
  /**
   * Resets this bounding box to its initial unbounded state.
   */
  reset() {
    this.min = { x: Infinity, y: Infinity };
    this.max = { x: -Infinity, y: -Infinity };
    this.valid = false;
  }
  /**
   * Retrieves the four corner points of the bounding box.
   *
   * @returns An array of corner points in the order:
   * bottom-left, top-left, bottom-right, top-right.
   */
  getCorners() {
    return [
      { x: this.min.x, y: this.min.y },
      { x: this.min.x, y: this.max.y },
      { x: this.max.x, y: this.min.y },
      { x: this.max.x, y: this.max.y }
    ];
  }
};

// ../../node_modules/@mlightcad/libredwg-web/lib/svg/bspline.js
function evaluateBSpline(t, degree, points, knots, weights) {
  const n = points.length;
  if (n === 0)
    throw new Error("points must not be empty");
  const d = points[0].length;
  if (t < 0 || t > 1) {
    throw new Error(`t out of bounds [0,1]: ${t}`);
  }
  if (degree < 1) {
    throw new Error("degree must be at least 1 (linear)");
  }
  if (degree > n - 1) {
    throw new Error("degree must be less than or equal to point count - 1");
  }
  const weightsSafe = weights ?? new Array(n).fill(1);
  const knotsSafe = knots ?? (() => {
    const result2 = [];
    for (let i = 0; i < n + degree + 1; i++) {
      result2.push(i);
    }
    return result2;
  })();
  if (knotsSafe.length !== n + degree + 1) {
    throw new Error("bad knot vector length");
  }
  const domain = [degree, knotsSafe.length - 1 - degree];
  const low = knotsSafe[domain[0]];
  const high = knotsSafe[domain[1]];
  t = t * (high - low) + low;
  t = Math.max(t, low);
  t = Math.min(t, high);
  let s = domain[0];
  for (; s < domain[1]; s++) {
    if (t >= knotsSafe[s] && t <= knotsSafe[s + 1]) {
      break;
    }
  }
  const v = new Array(n);
  for (let i = 0; i < n; i++) {
    v[i] = new Array(d + 1);
    for (let j = 0; j < d; j++) {
      v[i][j] = points[i][j] * weightsSafe[i];
    }
    v[i][d] = weightsSafe[i];
  }
  for (let l = 1; l <= degree + 1; l++) {
    for (let i = s; i > s - degree - 1 + l; i--) {
      const denom = knotsSafe[i + degree + 1 - l] - knotsSafe[i];
      const alpha = denom === 0 ? 0 : (t - knotsSafe[i]) / denom;
      for (let j = 0; j < d + 1; j++) {
        v[i][j] = (1 - alpha) * v[i - 1][j] + alpha * v[i][j];
      }
    }
  }
  const result = new Array(d);
  for (let i = 0; i < d; i++) {
    result[i] = round10(v[s][i] / v[s][d], -9);
  }
  return result;
}
function round10(value, exp) {
  if (exp === 0 || exp === void 0) {
    return Math.round(value);
  }
  if (isNaN(value) || !Number.isInteger(exp)) {
    return NaN;
  }
  const [base, exponent = "0"] = value.toString().split("e");
  const shifted = Math.round(Number(`${base}e${+exponent - exp}`));
  const [shiftedBase, shiftedExp = "0"] = shifted.toString().split("e");
  return Number(`${shiftedBase}e${+shiftedExp + exp}`);
}

// ../../node_modules/@mlightcad/libredwg-web/lib/svg/color.js
var _colorKeywords = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
var AUTO_CAD_COLOR_INDEX = [
  0,
  16711680,
  16776960,
  65280,
  65535,
  255,
  16711935,
  16777215,
  8421504,
  12632256,
  16711680,
  16744319,
  13369344,
  13395558,
  10027008,
  10046540,
  8323072,
  8339263,
  4980736,
  4990502,
  16727808,
  16752511,
  13382400,
  13401958,
  10036736,
  10051404,
  8331008,
  8343359,
  4985600,
  4992806,
  16744192,
  16760703,
  13395456,
  13408614,
  10046464,
  10056268,
  8339200,
  8347455,
  4990464,
  4995366,
  16760576,
  16768895,
  13408512,
  13415014,
  10056192,
  10061132,
  8347392,
  8351551,
  4995328,
  4997670,
  16776960,
  16777087,
  13421568,
  13421670,
  10000384,
  10000460,
  8355584,
  8355647,
  5000192,
  5000230,
  12582656,
  14679935,
  10079232,
  11717734,
  7510016,
  8755276,
  6258432,
  7307071,
  3755008,
  4344870,
  8388352,
  12582783,
  6736896,
  10079334,
  5019648,
  7510092,
  4161280,
  6258495,
  2509824,
  3755046,
  4194048,
  10485631,
  3394560,
  8375398,
  2529280,
  6264908,
  2064128,
  5209919,
  1264640,
  3099686,
  65280,
  8388479,
  52224,
  6736998,
  38912,
  5019724,
  32512,
  4161343,
  19456,
  2509862,
  65343,
  8388511,
  52275,
  6737023,
  38950,
  5019743,
  32543,
  4161359,
  19475,
  2509871,
  65407,
  8388543,
  52326,
  6737049,
  38988,
  5019762,
  32575,
  4161375,
  19494,
  2509881,
  65471,
  8388575,
  52377,
  6737074,
  39026,
  5019781,
  32607,
  4161391,
  19513,
  2509890,
  65535,
  8388607,
  52428,
  6737100,
  39064,
  5019800,
  32639,
  4161407,
  19532,
  2509900,
  49151,
  8380415,
  39372,
  6730444,
  29336,
  5014936,
  24447,
  4157311,
  14668,
  2507340,
  32767,
  8372223,
  26316,
  6724044,
  19608,
  5010072,
  16255,
  4153215,
  9804,
  2505036,
  16383,
  8364031,
  13260,
  6717388,
  9880,
  5005208,
  8063,
  4149119,
  4940,
  2502476,
  255,
  8355839,
  204,
  6710988,
  152,
  5000344,
  127,
  4145023,
  76,
  2500172,
  4129023,
  10452991,
  3342540,
  8349388,
  2490520,
  6245528,
  2031743,
  5193599,
  1245260,
  3089996,
  8323327,
  12550143,
  6684876,
  10053324,
  4980888,
  7490712,
  4128895,
  6242175,
  2490444,
  3745356,
  12517631,
  14647295,
  10027212,
  11691724,
  7471256,
  8735896,
  6226047,
  7290751,
  3735628,
  4335180,
  16711935,
  16744447,
  13369548,
  13395660,
  9961624,
  9981080,
  8323199,
  8339327,
  4980812,
  4990540,
  16711871,
  16744415,
  13369497,
  13395634,
  9961586,
  9981061,
  8323167,
  8339311,
  4980793,
  4990530,
  16711807,
  16744383,
  13369446,
  13395609,
  9961548,
  9981042,
  8323135,
  8339295,
  4980774,
  4990521,
  16711743,
  16744351,
  13369395,
  13395583,
  9961510,
  9981023,
  8323103,
  8339279,
  4980755,
  4990511,
  3355443,
  5987163,
  8684676,
  11382189,
  14079702,
  16777215,
  0
];
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
var Color = class _Color {
  _colorIndex;
  _color;
  _colorName;
  static NAMES = _colorKeywords;
  constructor() {
    this._colorIndex = 256;
    this._color = null;
    this._colorName = null;
  }
  get color() {
    return this._color;
  }
  set color(value) {
    if (value == null) {
      this._color = null;
    } else {
      this._color = Math.round(clamp(value, 0, 256 * 256 * 256 - 1));
      this._colorIndex = this.getColorIndexByValue(this._color);
      this._colorName = this.getColorNameByValue(this._color);
    }
  }
  get hexColor() {
    if (this._color && this._color > 0 && this._color <= 16777215) {
      let hexString = this._color.toString(16).toUpperCase();
      while (hexString.length < 6) {
        hexString = "0" + hexString;
      }
      return `0x${hexString}`;
    }
    return "";
  }
  get cssColor() {
    return `rgb(${this.red},${this.green},${this.blue})`;
  }
  get red() {
    return this.color != null ? this.color >> 16 & 255 : null;
  }
  get green() {
    return this.color != null ? this.color >> 8 & 255 : null;
  }
  get blue() {
    return this.color != null ? this.color & 255 : null;
  }
  /**
   * AutoCAD color index value. The index value will be in the range 0 to 256. 0 and 256 are special values.
   * If value less than 0 is set, 0 will be used. If value greater than 256 is set, 256 will be used.
   * - 0 indicates that the entity uses the color of the BlockReference that's displaying it. If the entity
   * is not displayed through a block reference (for example, it is directly owned by the model space
   * block table record) and its color is 0, then it will display as though its color were 7.
   * - 256 indicates that the entity uses the color specified in the layer table record it references.
   */
  get colorIndex() {
    return this._colorIndex;
  }
  set colorIndex(value) {
    if (value == null) {
      this._colorIndex = null;
    } else {
      this._colorIndex = clamp(value, 0, 256);
      this._color = AUTO_CAD_COLOR_INDEX[value];
      this._colorName = this.getColorNameByValue(this._color);
    }
  }
  get colorName() {
    return this._colorName;
  }
  set colorName(value) {
    if (value) {
      const color = _colorKeywords[value.toLowerCase()];
      if (color !== void 0) {
        this._colorName = value;
        this._color = color;
        this._colorIndex = this.getColorIndexByValue(this._color);
      } else {
        console.warn("Unknown color: " + value);
      }
    } else {
      this._colorName = null;
    }
  }
  get hasColorName() {
    return this._colorName == null;
  }
  get hasColorIndex() {
    return this._colorIndex == null;
  }
  get isByLayer() {
    return this.colorIndex == 256;
  }
  setByLayer() {
    this.colorIndex = 256;
    return this;
  }
  get isByBlock() {
    return this.colorIndex == 0;
  }
  setByBlock() {
    this.colorIndex = 0;
    return this;
  }
  setScalar(scalar) {
    this.setRGB(scalar, scalar, scalar);
    return this;
  }
  setRGB(r, g, b) {
    const red = Math.round(clamp(r, 0, 255));
    const green = Math.round(clamp(g, 0, 255));
    const blue = Math.round(clamp(b, 0, 255));
    this.color = (red << 16) + (green << 8) + blue;
    return this;
  }
  setColorName(style) {
    const color = _colorKeywords[style.toLowerCase()];
    if (color !== void 0) {
      this.color = color;
    } else {
      console.warn("Unknown color " + style);
    }
    return this;
  }
  clone() {
    const clonedColor = new _Color();
    clonedColor.colorIndex = this.colorIndex;
    clonedColor.color = this.color;
    clonedColor._colorName = this._colorName;
    return this;
  }
  copy(color) {
    this.colorIndex = color.colorIndex;
    this.color = color.color;
    this._colorName = color._colorName;
    return this;
  }
  equals(c) {
    return c.color == this.color && c.colorIndex == this.colorIndex && c._colorName == this._colorName;
  }
  toString() {
    if (this.isByLayer) {
      return "ByLayer";
    } else if (this.isByBlock) {
      return "ByBlock";
    } else if (this.colorName) {
      return this.colorName;
    } else {
      return this.hexColor;
    }
  }
  getColorNameByValue(target) {
    for (const [key, value] of Object.entries(_colorKeywords)) {
      if (value === target) {
        return key;
      }
    }
    return null;
  }
  getColorIndexByValue(target) {
    const length = AUTO_CAD_COLOR_INDEX.length - 1;
    for (let index = 1; index < length; ++index) {
      if (AUTO_CAD_COLOR_INDEX[index] === target) {
        return index;
      }
    }
    return null;
  }
};

// ../../node_modules/@mlightcad/libredwg-web/lib/svg/vector.js
var Vector2D = class _Vector2D {
  x;
  y;
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(v) {
    return new _Vector2D(this.x + v.x, this.y + v.y);
  }
  sub(v) {
    return new _Vector2D(this.x - v.x, this.y - v.y);
  }
  multiply(scalar) {
    return new _Vector2D(this.x * scalar, this.y * scalar);
  }
  length() {
    return Math.sqrt(this.x ** 2 + this.y ** 2);
  }
  norm() {
    const len = this.length();
    if (len === 0)
      return new _Vector2D(0, 0);
    return new _Vector2D(this.x / len, this.y / len);
  }
};

// ../../node_modules/@mlightcad/libredwg-web/lib/svg/polyline.js
function createPolylineArcPoints(from, to, bulge, resolution = 5) {
  let theta;
  let a;
  let b;
  if (bulge < 0) {
    theta = Math.atan(-bulge) * 4;
    a = new Vector2D(from.x, from.y);
    b = new Vector2D(to.x, to.y);
  } else {
    theta = Math.atan(bulge) * 4;
    a = new Vector2D(to.x, to.y);
    b = new Vector2D(from.x, from.y);
  }
  const ab = b.sub(a);
  const lengthAB = ab.length();
  const c = a.add(ab.multiply(0.5));
  const lengthCD = Math.abs(lengthAB / 2 / Math.tan(theta / 2));
  const normAB = ab.norm();
  const rotated = new Vector2D(normAB.x * Math.cos(Math.PI / 2) - normAB.y * Math.sin(Math.PI / 2), normAB.y * Math.cos(Math.PI / 2) + normAB.x * Math.sin(Math.PI / 2));
  const d = theta < Math.PI ? c.add(rotated.multiply(-lengthCD)) : c.add(rotated.multiply(lengthCD));
  const startAngle = Math.atan2(b.y - d.y, b.x - d.x) / Math.PI * 180;
  let endAngle = Math.atan2(a.y - d.y, a.x - d.x) / Math.PI * 180;
  if (endAngle < startAngle) {
    endAngle += 360;
  }
  const r = b.sub(d).length();
  const startInter = Math.floor(startAngle / resolution) * resolution + resolution;
  const endInter = Math.ceil(endAngle / resolution) * resolution - resolution;
  const points = [];
  for (let i = startInter; i <= endInter; i += resolution) {
    const angleRad = i / 180 * Math.PI;
    const point = d.add(new Vector2D(Math.cos(angleRad) * r, Math.sin(angleRad) * r));
    points.push(point);
  }
  if (bulge < 0) {
    points.reverse();
  }
  return points;
}
function interpolatePolyline(entity, closed = false) {
  let points = [];
  const vertices = entity.vertices.map((v) => {
    return {
      x: v.x,
      y: v.y,
      bulge: v.bulge
    };
  });
  if (closed) {
    vertices.push(vertices[0]);
  }
  for (let i = 0, len = vertices.length; i < len - 1; ++i) {
    const from = vertices[i];
    const to = vertices[i + 1];
    points.push(from);
    if (vertices[i].bulge) {
      points = points.concat(createPolylineArcPoints(from, to, entity.vertices[i].bulge));
    }
    if (i === len - 2) {
      points.push(to);
    }
  }
  return points;
}

// ../../node_modules/@mlightcad/libredwg-web/lib/svg/svgConverter.js
var SvgConverter = class {
  blockMap = /* @__PURE__ */ new Map();
  rotate(point, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos
    };
  }
  /**
   * Interpolates a B-spline curve and returns the resulting polyline.
   *
   * @param controlPoints The control points of the B-spline.
   * @param degree The degree of the B-spline.
   * @param knots The knot vector.
   * @param interpolationsPerSplineSegment Number of interpolated points per spline segment.
   * @param weights Optional weight vector for rational B-splines.
   * @returns An array of interpolated 2D points representing the polyline.
   */
  interpolateBSpline(controlPoints, degree, knots, interpolationsPerSplineSegment = 25, weights) {
    const polyline = [];
    const controlPointsForLib = controlPoints.map((p) => [p.x, p.y]);
    const segmentTs = [knots[degree]];
    const domain = [
      knots[degree],
      knots[knots.length - 1 - degree]
    ];
    for (let k = degree + 1; k < knots.length - degree; ++k) {
      if (segmentTs[segmentTs.length - 1] !== knots[k]) {
        segmentTs.push(knots[k]);
      }
    }
    for (let i = 1; i < segmentTs.length; ++i) {
      const uMin = segmentTs[i - 1];
      const uMax = segmentTs[i];
      for (let k = 0; k <= interpolationsPerSplineSegment; ++k) {
        const u = k / interpolationsPerSplineSegment * (uMax - uMin) + uMin;
        let t = (u - domain[0]) / (domain[1] - domain[0]);
        t = Math.max(0, Math.min(1, t));
        const p = evaluateBSpline(t, degree, controlPointsForLib, knots, weights);
        polyline.push({ x: p[0], y: p[1] });
      }
    }
    return polyline;
  }
  addFlipXIfApplicable(entity, { bbox, element }) {
    if ("extrusionDirection" in entity && entity.extrusionDirection.z === -1) {
      return {
        bbox: new Box2D().expandByPoint({ x: -bbox.min.x, y: bbox.min.y }).expandByPoint({ x: -bbox.max.x, y: bbox.max.y }),
        element: `<g transform="matrix(-1 0 0 1 0 0)">${element}</g>`
      };
    } else {
      return { bbox, element };
    }
  }
  line(entity) {
    const bbox = new Box2D().expandByPoint({ x: entity.startPoint.x, y: entity.startPoint.y }).expandByPoint({ x: entity.endPoint.x, y: entity.endPoint.y });
    const element = `<line x1="${entity.startPoint.x}" y1="${entity.startPoint.y}" x2="${entity.endPoint.x}" y2="${entity.endPoint.y}" />`;
    return { bbox, element };
  }
  ray(entity) {
    const scale = 1e4;
    const firstPoint = entity.firstPoint;
    const secondPoint = {
      x: firstPoint.x + entity.unitDirection.x * scale,
      y: firstPoint.y + entity.unitDirection.y * scale
    };
    const bbox = new Box2D().expandByPoint(firstPoint).expandByPoint(secondPoint);
    const element = `<line x1="${firstPoint.x}" y1="${firstPoint.y}" x2="${secondPoint.x}" y2="${secondPoint.y}" />`;
    return { bbox, element };
  }
  xline(entity) {
    const scale = 1e4;
    const firstPoint = {
      x: entity.firstPoint.x - entity.unitDirection.x * scale,
      y: entity.firstPoint.y - entity.unitDirection.y * scale
    };
    const secondPoint = {
      x: entity.firstPoint.x + entity.unitDirection.x * scale,
      y: entity.firstPoint.y + entity.unitDirection.y * scale
    };
    const bbox = new Box2D().expandByPoint(firstPoint).expandByPoint(secondPoint);
    const element = `<line x1="${firstPoint.x}" y1="${firstPoint.y}" x2="${secondPoint.x}" y2="${secondPoint.y}" />`;
    return { bbox, element };
  }
  extractMTextLines(mtext) {
    return mtext.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\P/g, "\n").replace(/\\[LOlo]/g, "").replace(/\\[Ff][^;\\]*?(?:\|[^;\\]*)*;/g, "").replace(/\\[KkCcHhWwTtAa][^;\\]*;?/g, "").replace(/\\[a-zA-Z]+;?/g, "").replace(/%%(d|p|c|%)/gi, "").replace(/\\\\/g, "\\").replace(/\\~/g, "\xA0").replace(/[{}]/g, "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  }
  lines(lines, fontsize, insertionPoint, extentsWidth, anchor = "start") {
    const bbox = new Box2D().expandByPoint({
      x: insertionPoint.x,
      y: insertionPoint.y
    }).expandByPoint({
      x: insertionPoint.x + extentsWidth,
      y: insertionPoint.y - lines.length * fontsize * 1.5
    });
    const texts = lines.map((line, index) => {
      const x = insertionPoint.x;
      const y = insertionPoint.y - index * fontsize * 1.5;
      const transform = `translate(${x},${y}) scale(1,-1) translate(${-x},${-y})`;
      return `<text x="${x}" y="${y}" font-size="${fontsize}" text-anchor="${anchor}" transform="${transform}">${line}</text>`;
    });
    return { bbox, element: texts.join("\n") };
  }
  mtext(entity) {
    const fontsize = entity.textHeight;
    const insertionPoint = entity.insertionPoint;
    const lines = this.extractMTextLines(entity.text);
    const attachmentPoint = entity.attachmentPoint;
    let anchor = "start";
    if (attachmentPoint == DwgAttachmentPoint.BottomCenter || attachmentPoint == DwgAttachmentPoint.MiddleCenter || attachmentPoint == DwgAttachmentPoint.TopCenter) {
      anchor = "middle";
    } else if (attachmentPoint == DwgAttachmentPoint.BottomRight || attachmentPoint == DwgAttachmentPoint.MiddleRight || attachmentPoint == DwgAttachmentPoint.TopRight) {
      anchor = "end";
    }
    return this.lines(lines, fontsize, insertionPoint, entity.extentsWidth, anchor);
  }
  table(entity) {
    const { rowCount, columnCount, rowHeightArr, columnWidthArr, startPoint, cells } = entity;
    const originX = startPoint.x;
    const originY = startPoint.y;
    const cellRects = [];
    for (let row = 0, y = originY; row < rowCount; row++) {
      const height = rowHeightArr[row];
      let x = originX;
      for (let col = 0; col < columnCount; col++) {
        const cellIndex = row * columnCount + col;
        const cell = cells[cellIndex];
        const width = columnWidthArr[col];
        cellRects.push({ x, y, width, height, cell, row, col });
        x += width;
      }
      y += height;
    }
    const svgElements = cellRects.map(({ x, y, width, height, cell }) => {
      const lines = [];
      if (cell.topBorderVisibility)
        lines.push(`<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="black" />`);
      if (cell.bottomBorderVisibility)
        lines.push(`<line x1="${x}" y1="${y + height}" x2="${x + width}" y2="${y + height}" stroke="black" />`);
      if (cell.leftBorderVisibility)
        lines.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y + height}" stroke="black" />`);
      if (cell.rightBorderVisibility)
        lines.push(`<line x1="${x + width}" y1="${y}" x2="${x + width}" y2="${y + height}" stroke="black" />`);
      const textX = x + width / 2;
      const textY = y + height / 2 + cell.textHeight / 3;
      const text = `<text x="${textX}" y="${textY}" font-size="${cell.textHeight}" text-anchor="middle" dominant-baseline="middle">${cell.text}</text>`;
      return [...lines, text].join("\n");
    }).join("\n");
    const totalWidth = columnWidthArr.reduce((sum, w) => sum + w, 0);
    const totalHeight = rowHeightArr.reduce((sum, h) => sum + h, 0);
    const bbox = new Box2D().expandByPoint({ x: originX, y: originY }).expandByPoint({ x: originX + totalWidth, y: originY + totalHeight });
    const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="${originX} ${originY} ${totalWidth} ${totalHeight}">
  ${svgElements}
  </svg>
    `.trim();
    return {
      bbox,
      element: svg
    };
  }
  text(entity) {
    const fontsize = entity.textHeight;
    const insertionPoint = entity.startPoint;
    const lines = [entity.text];
    let extentsWidth = entity.endPoint.x - entity.endPoint.x;
    if (entity.halign == 0) {
      extentsWidth = entity.text.length * fontsize + entity.startPoint.x;
    }
    let anchor = "start";
    if (entity.halign == DwgTextHorizontalAlign.CENTER) {
      anchor = "middle";
    } else if (entity.halign == DwgTextHorizontalAlign.RIGHT) {
      anchor = "end";
    }
    return this.lines(lines, fontsize, insertionPoint, extentsWidth, anchor);
  }
  vertices(vertices, closed = false) {
    const bbox = vertices.reduce((acc, point) => acc.expandByPoint(point), new Box2D());
    let d = vertices.reduce((acc, point, i) => {
      acc += i === 0 ? "M" : "L";
      acc += point.x + "," + point.y;
      return acc;
    }, "");
    if (closed) {
      d += "Z";
    }
    return { bbox, element: `<path d="${d}" />` };
  }
  circle(entity) {
    const bbox0 = new Box2D().expandByPoint({
      x: entity.center.x + entity.radius,
      y: entity.center.y + entity.radius
    }).expandByPoint({
      x: entity.center.x - entity.radius,
      y: entity.center.y - entity.radius
    });
    const element0 = `<circle cx="${entity.center.x}" cy="${entity.center.y}" r="${entity.radius}" />`;
    return {
      bbox: bbox0,
      element: element0
    };
  }
  ellipseOrArc(cx, cy, majorX, majorY, axisRatio, startAngle, endAngle) {
    const rx = Math.sqrt(majorX * majorX + majorY * majorY);
    const ry = axisRatio * rx;
    const rotationAngle = -Math.atan2(-majorY, majorX);
    const bbox = this.bboxEllipseOrArc(cx, cy, majorX, majorY, axisRatio, startAngle, endAngle);
    if (Math.abs(startAngle - endAngle) < 1e-9 || Math.abs(startAngle - endAngle + Math.PI * 2) < 1e-9) {
      const element = `<g transform="rotate(${rotationAngle / Math.PI * 180} ${cx}, ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" /></g>`;
      return { bbox, element };
    } else {
      const startOffset = this.rotate({ x: Math.cos(startAngle) * rx, y: Math.sin(startAngle) * ry }, rotationAngle);
      const startPoint = { x: cx + startOffset.x, y: cy + startOffset.y };
      const endOffset = this.rotate({ x: Math.cos(endAngle) * rx, y: Math.sin(endAngle) * ry }, rotationAngle);
      const endPoint = { x: cx + endOffset.x, y: cy + endOffset.y };
      const adjustedEndAngle = endAngle < startAngle ? endAngle + Math.PI * 2 : endAngle;
      const largeArcFlag = adjustedEndAngle - startAngle < Math.PI ? 0 : 1;
      const d = `M ${startPoint.x} ${startPoint.y} A ${rx} ${ry} ${rotationAngle / Math.PI * 180} ${largeArcFlag} 1 ${endPoint.x} ${endPoint.y}`;
      const element = `<path d="${d}" />`;
      return { bbox, element };
    }
  }
  bboxEllipseOrArc(cx, cy, majorX, majorY, axisRatio, startAngle, endAngle) {
    while (startAngle < 0)
      startAngle += Math.PI * 2;
    while (endAngle <= startAngle)
      endAngle += Math.PI * 2;
    const angles = [];
    if (Math.abs(majorX) < 1e-12 || Math.abs(majorY) < 1e-12) {
      for (let i = 0; i < 4; i++) {
        angles.push(i / 2 * Math.PI);
      }
    } else {
      angles[0] = Math.atan(-majorY * axisRatio / majorX) - Math.PI;
      angles[1] = Math.atan(majorX * axisRatio / majorY) - Math.PI;
      angles[2] = angles[0] - Math.PI;
      angles[3] = angles[1] - Math.PI;
    }
    for (let i = 4; i >= 0; i--) {
      while (angles[i] < startAngle)
        angles[i] += Math.PI * 2;
      if (angles[i] > endAngle) {
        angles.splice(i, 1);
      }
    }
    angles.push(startAngle);
    angles.push(endAngle);
    const pts = angles.map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));
    const M = [
      [majorX, -majorY * axisRatio],
      [majorY, majorX * axisRatio]
    ];
    const rotatedPts = pts.map((p) => ({
      x: p.x * M[0][0] + p.y * M[0][1] + cx,
      y: p.x * M[1][0] + p.y * M[1][1] + cy
    }));
    const bbox = rotatedPts.reduce((acc, p) => {
      acc.expandByPoint(p);
      return acc;
    }, new Box2D());
    return bbox;
  }
  ellipse(entity) {
    const { bbox: bbox0, element: element0 } = this.ellipseOrArc(entity.center.x, entity.center.y, entity.majorAxisEndPoint.x, entity.majorAxisEndPoint.y, entity.axisRatio, entity.startAngle, entity.endAngle);
    return {
      bbox: bbox0,
      element: element0
    };
  }
  arc(entity) {
    const { bbox: bbox0, element: element0 } = this.ellipseOrArc(entity.center.x, entity.center.y, entity.radius, 0, 1, entity.startAngle, entity.endAngle);
    return {
      bbox: bbox0,
      element: element0
    };
  }
  dimension(entity) {
    const block = this.blockMap.get(entity.name);
    if (block) {
      return {
        bbox: block.bbox,
        element: `<use href="#${entity.name}" />`
      };
    }
    return null;
  }
  insert(entity) {
    const block = this.blockMap.get(entity.name);
    if (block) {
      const insertionPoint = entity.insertionPoint;
      const rotation = entity.rotation * (180 / Math.PI);
      const transform = `translate(${insertionPoint.x},${insertionPoint.y}) rotate(${rotation}) scale(${entity.xScale},${entity.yScale})`;
      const newBBox = block.bbox.clone().transform({ x: entity.xScale, y: entity.yScale }, { x: insertionPoint.x, y: insertionPoint.y }).rotate(entity.rotation, insertionPoint);
      return {
        bbox: newBBox,
        element: `<use href="#${entity.name}" transform="${transform}" />`
      };
    }
    return null;
  }
  block(block, dwg) {
    const entities = block.entities;
    const { bbox, elements } = entities.reduce((acc, entity) => {
      const boundsAndElement = this.entityToBoundsAndElement(entity);
      if (boundsAndElement) {
        const { bbox: bbox2, element } = boundsAndElement;
        if (bbox2.valid) {
          acc.bbox.expandByPoint(bbox2.min);
          acc.bbox.expandByPoint(bbox2.max);
        }
        const color = this.getEntityColor(dwg.tables.LAYER.entries, entity);
        const fill = entity.type == "TEXT" || entity.type == "MTEXT" ? color.cssColor : "none";
        if (color.isByBlock) {
          acc.elements.push(`<g id="${entity.handle}">${element}</g>`);
        } else {
          acc.elements.push(`<g id="${entity.handle}" stroke="${color.cssColor}" fill="${fill}">${element}</g>`);
        }
      }
      return acc;
    }, {
      bbox: new Box2D(),
      elements: []
    });
    if (bbox.valid) {
      return {
        bbox,
        element: `<g id="${block.name}">${elements.join("\n")}</g>`
      };
    }
    return null;
  }
  entityToBoundsAndElement(entity) {
    let result = null;
    switch (entity.type) {
      case "ARC":
        result = this.arc(entity);
        break;
      case "CIRCLE":
        result = this.circle(entity);
        break;
      case "DIMENSION":
        result = this.dimension(entity);
        break;
      case "ELLIPSE":
        result = this.ellipse(entity);
        break;
      case "INSERT":
        result = this.insert(entity);
        break;
      case "LINE":
        result = this.line(entity);
        break;
      case "LWPOLYLINE": {
        const lwpolyline = entity;
        const closed = !!(lwpolyline.flag & 512);
        const vertices = interpolatePolyline(lwpolyline, closed);
        result = this.vertices(vertices, closed);
        break;
      }
      case "MTEXT":
        result = this.mtext(entity);
        break;
      case "SPLINE": {
        const spline = entity;
        result = this.vertices(this.interpolateBSpline(spline.controlPoints, spline.degree, spline.knots, 25, spline.weights));
        break;
      }
      case "POLYLINE": {
        break;
      }
      case "RAY":
        result = this.ray(entity);
        break;
      case "TABLE":
        result = this.table(entity);
        break;
      case "TEXT":
        result = this.text(entity);
        break;
      case "XLINE":
        result = this.xline(entity);
        break;
      default:
        result = null;
        break;
    }
    if (result) {
      return this.addFlipXIfApplicable(entity, result);
    }
    return null;
  }
  getEntityColor(layers, entity) {
    const color = new Color();
    if (entity.colorIndex != null) {
      color.colorIndex = entity.colorIndex;
    } else if (entity.colorName) {
      color.colorName = entity.colorName;
    } else if (entity.color != null) {
      color.color = entity.color;
    }
    if (color.colorIndex == 7) {
      color.colorIndex = 256;
    }
    if (color.isByLayer) {
      const layer = layers.find((layer2) => layer2.name === entity.layer);
      if (layer != null) {
        color.colorIndex = layer.colorIndex;
      }
    }
    if (color.color == null) {
      color.color = 16777215;
    }
    return color;
  }
  convert(dwg) {
    let modelSpace = null;
    this.blockMap.clear();
    let blockElements = "";
    dwg.tables.BLOCK_RECORD.entries.forEach((block) => {
      if (isModelSpace(block.name)) {
        modelSpace = block;
      } else {
        const item = this.block(block, dwg);
        if (item) {
          blockElements += item.element;
          this.blockMap.set(block.name, item);
        }
      }
    });
    const ms = this.block(modelSpace, dwg);
    const viewBox = ms && ms.bbox.valid ? {
      x: ms.bbox.min.x,
      y: -ms.bbox.max.y,
      width: ms.bbox.max.x - ms.bbox.min.x,
      height: ms.bbox.max.y - ms.bbox.min.y
    } : {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
    return `<?xml version="1.0"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"
  preserveAspectRatio="xMinYMin meet"
  viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"
  width="100%" height="100%"
>
  <defs>${blockElements}</defs>
  <g stroke="#000000" stroke-width="0.1%" fill="none" transform="matrix(1,0,0,-1,0,0)">
    ${ms ? ms.element : ""}
  </g>
</svg>`;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SvgConverter
});
