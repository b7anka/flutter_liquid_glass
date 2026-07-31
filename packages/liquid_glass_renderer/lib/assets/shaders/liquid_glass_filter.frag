// Copyright 2025, Tim Lehmann for whynotmake.it
//
// This shader is based on a bunch of sources:
// - https://www.shadertoy.com/view/wccSDf for the refraction
// - https://iquilezles.org/articles/distfunctions2d/ for SDFs
// - Gracious help from @dkwingsmt for the Squircle SDF
//
// Feel free to use this shader in your own projects, it'd be lovely if you could
// give some credit like I did here.

#version 460 core
precision mediump float;

#define DEBUG_NORMALS 0

#include <flutter/runtime_effect.glsl>

// Declare sampler BEFORE including shared.glsl so BACKGROUND_TEXTURE macro can resolve it.
uniform sampler2D uBlurredTexture;
#define BACKGROUND_TEXTURE uBlurredTexture
#include "shared.glsl"

// Declare uShapeData BEFORE including sdf.glsl so SHAPE_DATA macro can resolve it.
// MAX_SHAPES=16, 6 floats per shape = 96 total.
layout(location = 5) uniform float uNumShapes;
layout(location = 6) uniform float uShapeData[96];
#define SHAPE_DATA uShapeData
#include "sdf.glsl"

// Optimized uniform layout - grouped into vectors for better performance
layout(location = 0) uniform vec2 uSize;                    // width, height
layout(location = 1) uniform vec4 uGlassColor;             // r, g, b, a
layout(location = 2) uniform vec4 uOpticalProps;           // refractiveIndex, chromaticAberration, thickness, blend
layout(location = 3) uniform vec4 uLightConfig;            // angle, intensity, ambient, saturation
layout(location = 4) uniform vec2 uLightDirection;         // pre-computed cos(angle), sin(angle)

// Extract individual values for backward compatibility
float uChromaticAberration = uOpticalProps.y;
float uLightIntensity = uLightConfig.y;
float uAmbientStrength = uLightConfig.z;
float uThickness = uOpticalProps.z;
float uRefractiveIndex = uOpticalProps.x;
float uBlend = uOpticalProps.w;
float uSaturation = uLightConfig.w;

layout(location = 0) out vec4 fragColor;

void main() {
    vec2 fragCoord = FlutterFragCoord().xy;
     
    // We invert screenUV Y on OpenGL to sample the textures correctly
    #ifdef IMPELLER_TARGET_OPENGLES
        vec2 screenUV = vec2(fragCoord.x / uSize.x, 1.0 - (fragCoord.y / uSize.y));
    #else
        vec2 screenUV = vec2(fragCoord.x / uSize.x, fragCoord.y / uSize.y);
    #endif
    
    float sd = sceneSDF(fragCoord, int(uNumShapes), uBlend);
    float foregroundAlpha = 1.0 - smoothstep(-2.0, 0.0, sd);

    if (foregroundAlpha < 0.01) {
        fragColor = vec4(0, 0, 0, 0);
        return;
    }

    vec3 normal = getNormal(sd, uThickness);
    
    fragColor = renderLiquidGlass(
        screenUV, 
        fragCoord, 
        uSize, 
        sd, 
        uThickness, 
        uRefractiveIndex, 
        uChromaticAberration, 
        uGlassColor, 
        uLightDirection, 
        uLightIntensity, 
        uAmbientStrength, 
        normal,
        foregroundAlpha,
        0.0,
        uSaturation
    );
    
    #if DEBUG_NORMALS
        fragColor = debugNormals(fragColor, normal, true);
    #endif
}
