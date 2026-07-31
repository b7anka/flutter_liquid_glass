// Copyright 2025, Tim Lehmann for whynotmake.it
//
// Geometry precomputation shader for blended liquid glass shapes
// This shader pre-computes the refraction displacement and encodes it into a texture
// Only needs to be re-run when shape geometry or layout changes

#version 460 core
precision mediump float;

#include <flutter/runtime_effect.glsl>

// Declare uShapeData BEFORE including sdf.glsl so SHAPE_DATA macro can resolve it.
// MAX_SHAPES=16, 6 floats per shape = 96 total (hardcoded to avoid forward-declaration issue).
layout(location = 2) uniform float uNumShapes;
layout(location = 3) uniform float uShapeData[96];

#define SHAPE_DATA uShapeData
#include "sdf.glsl"
#include "displacement_encoding.glsl"

layout(location = 0) uniform vec2 uSize;
layout(location = 1) uniform vec4 uOpticalProps;

float uThickness = uOpticalProps.z;
float uRefractiveIndex = uOpticalProps.x;
float uBlend = uOpticalProps.w;

layout(location = 0) out vec4 fragColor;

void main() {
    vec2 fragCoord = FlutterFragCoord().xy;
    
    #ifdef IMPELLER_TARGET_OPENGLES
        vec2 screenUV = vec2(fragCoord.x / uSize.x, 1.0 - (fragCoord.y / uSize.y));
    #else
        vec2 screenUV = vec2(fragCoord.x / uSize.x, fragCoord.y / uSize.y);
    #endif
    
    float sd = sceneSDF(fragCoord, int(uNumShapes), uBlend);

    float foregroundAlpha = 1.0 - smoothstep(-2.0, 0.0, sd);
    if (foregroundAlpha < 0.01) {
        fragColor = vec4(0.0);
        return;
    }
    
    // dFdx/dFdy not available in SkSL runtime effects (web); guarded by kIsWeb in Dart.
#if defined(IMPELLER_TARGET_METAL) || defined(IMPELLER_TARGET_OPENGLES) || defined(IMPELLER_TARGET_VULKAN)
    float dx = dFdx(sd);
    float dy = dFdy(sd);
#else
    float dx = 0.0;
    float dy = 0.0;
#endif

    float n_cos = max(uThickness + sd, 0.0) / uThickness;
    float n_sin = sqrt(max(0.0, 1.0 - n_cos * n_cos));
    
    vec3 normal = normalize(vec3(dx * n_cos, dy * n_cos, n_sin));
    
    if (sd >= 0.0 || uThickness <= 0.0) {
        fragColor = vec4(0.0);
        return;
    }
    
    float x = uThickness + sd;
    float sqrtTerm = sqrt(max(0.0, uThickness * uThickness - x * x));
    float height = mix(sqrtTerm, uThickness, float(sd < -uThickness));
    
    float baseHeight = uThickness * 8.0;
    vec3 incident = vec3(0.0, 0.0, -1.0);
    
    float invRefractiveIndex = 1.0 / uRefractiveIndex;
    vec3 baseRefract = refract(incident, normal, invRefractiveIndex);
    float baseRefractLength = (height + baseHeight) / max(0.001, abs(baseRefract.z));
    vec2 displacement = baseRefract.xy * baseRefractLength;
    
    float maxDisplacement = uThickness * 10.0;
    
    fragColor = encodeDisplacementData(displacement, maxDisplacement, height, uThickness, foregroundAlpha);
}
