#!/usr/bin/env bash
# median/min/max of TTFB and total per label, mode, condition
sed -E 's/ttfb=//; s/total=//' "$1" | awk '{k=$1" "$2" "$3; print k, $4*1000, $5*1000}' | sort -k1,3 -k4,4n | awk '{k=$1" "$2" "$3; n[k]++; v[k,n[k]]=$4; s[k]+=$5} END{for(k in n) printf "%-40s n=%-3d ttfb med %6.0f min %6.0f max %6.0f | total mean %6.0f\n", k, n[k], v[k,int((n[k]+1)/2)], v[k,1], v[k,n[k]], s[k]/n[k]}' | sort
